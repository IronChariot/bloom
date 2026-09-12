import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { withIdentity } from '../web/lib/identity.js';
import { newGraph } from '../web/lib/graph.js';
import { placeLabel } from '../web/public/canvas/presence-view.js';

test('shared selections and exclusive text leases protect transactions without changing revisions', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync('web/drizzle').filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(`web/drizzle/${file}`, 'utf8'));
  let beforeBatch;
  const db = {
    prepare(query) { return { bind(...args) { const stmt = sql.prepare(query); return {
      first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }), run: async () => ({ meta: stmt.run(...args) })
    }; } }; },
    async batch(statements) { if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook(); } sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; } catch (e) { sql.exec('ROLLBACK'); throw e; } }
  };
  globalThis.__bloomPresenceEnv = { DB: db };
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier === 'cloudflare:workers' ? { url: 'data:text/javascript,export const env = globalThis.__bloomPresenceEnv;', shortCircuit: true } : next(specifier, context); } });
  try {
    const { handleApi, changeBoard } = await import('../web/lib/boards.js');
    const alice = { userId: 'alice', displayName: 'Alice' }, bob = { userId: 'bob', displayName: 'Bob' };
    const api = (who, segments, body) => withIdentity(who, () => handleApi(new Request(`https://bloom.test/api/${segments.join('/')}`, body === undefined ? {} : { method: 'POST', headers: { Origin: 'https://bloom.test' }, body: JSON.stringify(body) }), segments));
    const { id } = await api(alice, ['boards'], { graph: newGraph(true) });
    sql.prepare('INSERT INTO members VALUES (?, ?, ?, ?, 0)').run(id, 'bob', 'Bob', 'editor');
    const graph = JSON.parse(sql.prepare('SELECT graph FROM boards WHERE id = ?').get(id).graph), node = graph.nodes[0].id, other = graph.nodes[1].id;
    const state = () => sql.prepare('SELECT * FROM boards WHERE id = ?').get(id);
    const presence = (who, body) => api(who, ['boards', id, 'presence'], { sessionId: who.userId + '-tab', ...body });
    const edit = (who, operations, extra = {}) => api(who, ['boards', id, 'edit'], { expectedRevision: state().revision, operations, ...extra });
    const acquire = (who, token = who.userId, nodeId = node) => presence(who, { action: 'acquire', nodeId, token, selection: { kind: 'nodes', ids: [nodeId] } });
    await acquire(alice);
    await assert.rejects(acquire(bob), { status: 423 });
    await assert.rejects(presence(alice, { sessionId: 'alice-other-tab', action: 'acquire', nodeId: node, token: 'different' }), { status: 423 });
    await presence(bob, { selection: { kind: 'edges', ids: [graph.edges[0].id] } });
    const sync = await api(bob, ['boards', id, 'sync'], { revision: 0 });
    assert.equal(sync.state, undefined);
    assert.equal(sync.presence.find(p => p.sessionId === 'alice-tab').editing, node);
    assert.equal(sync.presence.find(p => p.userId === 'bob').kind, 'edges');
    assert.equal(state().revision, 0); assert.equal(state().past, '[]');
    await assert.rejects(edit(bob, [{ type: 'updateNode', id: node, text: 'Clobber' }]), { status: 423 });
    await assert.rejects(edit(bob, [{ type: 'deleteNodes', ids: [node] }]), { status: 423 });
    await assert.rejects(changeBoard(state(), { userId: 'agent', displayName: 'Agent' }, 'agent', { operations: [{ type: 'updateNode', id: node, text: 'Agent text' }], expectedRevision: state().revision }, 'delta'), { status: 423 });
    const imported = structuredClone(graph); imported.nodes[0].text = 'Replacement';
    await assert.rejects(api(bob, ['boards', id, 'edit'], { action: 'import', graph: imported, expectedRevision: state().revision }), { status: 423 });
    assert.equal(state().revision, 0); assert.equal(sql.prepare('SELECT count(*) AS n FROM changes').get().n, 0);
    await edit(bob, [{ type: 'updateNode', id: node, x: 42 }]);
    await edit(bob, [{ type: 'updateNode', id: other, text: 'Unrelated edit' }]);
    await edit(alice, [{ type: 'updateNode', id: node, text: 'Alice’s text' }], { sessionId: 'alice-tab', editLease: { nodeId: node, token: 'alice' } });
    await assert.rejects(api(bob, ['boards', id, 'edit'], { action: 'undo', expectedRevision: state().revision }), { status: 423 });
    await presence(alice, { action: 'release', nodeId: node, token: 'alice' });
    await acquire(bob);
    await presence(alice, { action: 'release', nodeId: node, token: 'alice' });
    assert.equal(sql.prepare('SELECT user_id FROM edit_locks WHERE node_id = ?').get(node).user_id, 'bob');
    sql.prepare('UPDATE edit_locks SET expires = 1').run();
    await assert.rejects(edit(bob, [{ type: 'updateNode', id: node, text: 'Expired draft' }], { sessionId: 'bob-tab', editLease: { nodeId: node, token: 'bob' } }), { status: 423 });
    await assert.rejects(presence(bob, { action: 'renew', nodeId: node, token: 'bob' }), { status: 423 });
    await acquire(alice, 'new-token');
    await presence(alice, { action: 'release', nodeId: node, token: 'alice' });
    assert.equal(sql.prepare('SELECT token FROM edit_locks WHERE node_id = ?').get(node).token, 'new-token');
    await presence(alice, { action: 'leave' });
    assert.equal(sql.prepare('SELECT count(*) AS n FROM edit_locks').get().n, 0);
    // Acquire after the graph was read but before its write transaction begins.
    beforeBatch = () => acquire(alice, 'race-token');
    const rev = state().revision;
    await assert.rejects(edit(bob, [{ type: 'updateNode', id: node, text: 'Racing write' }]), { status: 423 });
    assert.equal(state().revision, rev);
    await api(alice, ['me'], { displayName: 'Alicia' });
    assert.equal((await api(bob, ['boards', id, 'sync'], { revision: rev })).presence.find(p => p.userId === 'alice').name, 'Alicia');
    await assert.rejects(presence({ userId: 'stranger' }, { action: 'select' }), { status: 403 });
    await assert.rejects(presence(bob, { selection: { kind: 'nodes', ids: [null] } }), { status: 400 });
    sql.prepare('UPDATE presence SET expires = 1').run();
    sql.prepare('UPDATE edit_locks SET expires = 1').run();
    assert.deepEqual((await api(bob, ['boards', id, 'sync'], { revision: rev })).presence, []);
    await acquire(bob, 'after-disconnect');
  } finally { hooks.deregister(); delete globalThis.__bloomPresenceEnv; sql.close(); }
});

test('name labels find room outside the target, adjacent blobs and earlier labels', () => {
  const obstacles = [{ x: 300, y: 250, w: 160, h: 120 }, { x: 280, y: 175, w: 210, h: 60 }];
  const box = placeLabel({ x: 380, y: 310, rx: 80, ry: 60 }, 150, obstacles, { w: 1000, h: 700 });
  for (const other of obstacles) assert.ok(box.x >= other.x + other.w || box.x + box.w <= other.x || box.y >= other.y + other.h || box.y + box.h <= other.y);
});
