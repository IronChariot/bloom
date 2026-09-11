import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { limitHistory, HISTORY_BYTES } from '../web/lib/history.js';

// Exercise the actual browser scheduler with a controlled clock and network.
const source = await fs.readFile('web/public/canvas/bridge.js', 'utf8');
let now = 100000, nextTimer = 0, calls = [], timers = new Map(), listeners = {}, fail = false;
const fakeDocument = { hidden: false, querySelector: () => null, addEventListener: (name, fn) => { listeners[name] = fn; } };
const sandbox = { URL, Date: class extends Date { static now() { return now; } }, console, document: fakeDocument,
  window: { parent: { location: { href: 'https://example.test/' } }, addEventListener: (name, fn) => { listeners[name] = fn; } },
  setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
  fetch: async (path, options) => { calls.push({ path, options }); if (fail) throw Error('offline'); return { ok: true, json: async () => ({ revision: 0, members: [], agentEnabled: true }) }; }
};
vm.createContext(sandbox);
vm.runInContext(source.slice(0, source.indexOf('const html =')).replace('export async function captureBoard', 'async function captureBoard') + '\ncurrent = { revision: 0 }; boardId = "test"; started = true; globalThis.check = { pollBoard, schedulePoll };', sandbox);
await sandbox.check.pollBoard(); assert.equal(calls.length, 1); assert.equal([...timers.values()].at(-1).delay, 2000);
now += 31000; await sandbox.check.pollBoard(); assert.equal([...timers.values()].at(-1).delay, 15000);
fakeDocument.hidden = true; listeners.visibilitychange(); assert.equal(timers.size, 0);
const count = calls.length; await sandbox.check.pollBoard(); assert.equal(calls.length, count); assert.equal(timers.size, 0);
fakeDocument.hidden = false; listeners.visibilitychange(); assert.equal([...timers.values()].at(-1).delay, 0);
fail = true; await sandbox.check.pollBoard(); assert.equal([...timers.values()].at(-1).delay, 4000);
await sandbox.check.pollBoard(); assert.equal([...timers.values()].at(-1).delay, 8000);
assert.ok(calls.every(c => c.path.endsWith('/sync')));
console.log('PASS: actual scheduler active/idle timing, hidden-tab silence, immediate resume and failure backoff');

// Validate migration against legacy undo/redo references and unreachable history.
const database = new DatabaseSync(':memory:');
database.exec(await fs.readFile('web/drizzle/0000_charming_hellion.sql', 'utf8'));
database.prepare('INSERT INTO boards (id, owner, graph, updated, past, future) VALUES (?, ?, ?, ?, ?, ?)').run('legacy', 'owner', '{}', 1, JSON.stringify(Array.from({ length: 50 }, (_, i) => i)), '[50,51]');
const insert = database.prepare('INSERT INTO changes VALUES (?, ?, ?, ?, ?, ?)');
for (let i = 0; i < 60; i++) insert.run('legacy', i, 'x'.repeat(200000), 'owner', i, 'edit');
database.exec(await fs.readFile('web/drizzle/0001_wonderful_overlord.sql', 'utf8'));
const retained = database.prepare('SELECT COUNT(*) AS n, SUM(length(CAST(graph AS BLOB))) AS bytes FROM changes').get();
assert.ok(retained.n <= 50 && retained.bytes <= HISTORY_BYTES);
const stacks = database.prepare('SELECT past, future FROM boards').get();
for (const rev of [...JSON.parse(stacks.past), ...JSON.parse(stacks.future)]) assert.ok(database.prepare('SELECT 1 FROM changes WHERE revision = ?').get(rev));
assert.deepEqual(JSON.parse(stacks.future), [50, 51]);
const past = Array.from({ length: 55 }, (_, i) => i), future = [100, 101];
limitHistory(past, future, new Map([...past, ...future].map(i => [i, 600000])));
assert.ok((past.length + future.length) * 600000 <= HISTORY_BYTES); assert.equal(past.at(-1), 54); assert.equal(future.at(-1), 101);
database.close(); console.log('PASS: migration physically prunes history within count/byte limits and preserves valid undo/redo stacks');

const base = 'http://127.0.0.1:8787', owner = `efficiency-${Date.now()}`, guest = owner + '-guest';
const headers = name => ({ 'oai-authenticated-user-id': name, 'oai-authenticated-user-email': `${name}@test.invalid`, 'Content-Type': 'application/json' });
async function api(path, body, expected = 200, name = owner) {
  const response = await fetch(`${base}/api/${path}`, { headers: headers(name), ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
}
const { id } = await api('boards', {}), initial = await api(`boards/${id}`), root = initial.graph.nodes[0].id;
await api(`boards/${id}/sync`, { revision: 0 }, 403, guest);
let sync = await api(`boards/${id}/sync`, { revision: 0 }); assert.equal(sync.state, undefined); assert.equal(sync.captureRequested, null);
assert.ok(JSON.stringify(sync).length < 1000); assert.equal('image' in sync, false);
const invite = await api(`boards/${id}/invite`, {}); await api(`boards/${id}/join`, invite, 200, guest);
for (let i = 0; i < 55; i++) await api(`boards/${id}/edit`, { expectedRevision: i, operations: [{ type: 'updateNode', id: root, text: `Edit ${i}` }] });
sync = await api(`boards/${id}/sync`, { revision: 0 }); assert.equal(sync.state.revision, 55);
for (let i = 0; i < 50; i++) await api(`boards/${id}/edit`, { expectedRevision: 55 + i, action: 'undo' });
const undone = await api(`boards/${id}`); assert.equal(undone.graph.nodes[0].text, 'Edit 4'); assert.equal(undone.canUndo, false);
await api(`boards/${id}/edit`, { expectedRevision: 105, action: 'undo' }, 400);
for (let i = 0; i < 50; i++) await api(`boards/${id}/edit`, { expectedRevision: 105 + i, action: 'redo' });
let state = await api(`boards/${id}`); assert.equal(state.graph.nodes[0].text, 'Edit 54'); assert.equal(state.canRedo, false);
const race = await Promise.all([owner, guest].map(name => fetch(`${base}/api/boards/${id}/edit`, { method: 'POST', headers: headers(name), body: JSON.stringify({ expectedRevision: state.revision, operations: [{ type: 'updateNode', id: root, text: name }] }) })));
assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
console.log('PASS: compact authorized sync, 50-step undo/redo across retention, concurrent writes');

const { token } = await api(`boards/${id}/agent`, {}), client = new Client({ name: 'efficiency-test', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp?board=${id}`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
try {
  assert.match(client.getInstructions(), /No separate skill file/);
  let picture = await client.callTool({ name: 'get_board_image', arguments: {} }); assert.equal(picture.isError, true);
  state = await api(`boards/${id}`); sync = await api(`boards/${id}/sync`, { revision: state.revision }); assert.ok(sync.captureRequested);
  await client.callTool({ name: 'get_board_image', arguments: {} });
  assert.equal((await api(`boards/${id}/sync`, { revision: state.revision })).captureRequested, sync.captureRequested);
  const upload = { image: 'iVBORw0KGgo=', revision: state.revision, requestedAt: sync.captureRequested };
  assert.equal((await api(`boards/${id}/image`, { ...upload, revision: state.revision - 1 })).accepted, false);
  const uploads = await Promise.all([owner, guest].map(name => api(`boards/${id}/image`, upload, 200, name)));
  assert.equal(uploads.filter(u => u.accepted).length, 1);
  picture = await client.callTool({ name: 'get_board_image', arguments: {} }); assert.ok(picture.content.some(c => c.type === 'image'));
  assert.match(picture.content[0].text, /Cached snapshot/);
  assert.equal((await api(`boards/${id}/sync`, { revision: state.revision })).captureRequested, null);
  await api(`boards/${id}/edit`, { expectedRevision: state.revision, operations: [{ type: 'updateNode', id: root, text: 'New revision' }] });
  picture = await client.callTool({ name: 'get_board_image', arguments: {} }); assert.match(picture.content[0].text, /STALE/);
  await api(`boards/${id}/agent`, { enabled: false });
  assert.equal((await client.callTool({ name: 'get_board_image', arguments: {} })).isError, true);
  assert.equal((await api(`boards/${id}/sync`, { revision: state.revision + 1 })).captureRequested, null);
  await api(`boards/${id}/member`, { userId: guest }); await api(`boards/${id}/sync`, { revision: 0 }, 403, guest);
  console.log('PASS: MCP instructions, on-demand images, coalesced requests, one winning upload, stale revisions and pause/access revocation');
} finally { await client.close(); }
