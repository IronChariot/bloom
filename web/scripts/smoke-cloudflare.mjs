import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { cfApi, accountId } from './cf-api.mjs';
import { newGraph } from '../lib/graph.js';
import { boardCode } from '../public/canvas/agent-code.js';

// Runs against the configured deployment. Mutations affect only a temporary board.
const config = JSON.parse(await fs.readFile(new URL('../cloudflare/agent.jsonc', import.meta.url), 'utf8'));
const database = config.d1_databases[0].database_id;
const origin = 'https://bloom-mcp.theothersam.workers.dev';
const query = async (sql, params = []) => {
  const result = await cfApi(`/accounts/${accountId}/d1/database/${database}/query`, 'POST', { sql, params });
  assert.ok(result.every(r => r.success), 'D1 query failed');
  return result;
};
const digest = value => createHash('sha256').update(value).digest('hex');
const id = `smoke-${randomUUID()}`, token = randomBytes(32).toString('hex');
const graph = newGraph(), clients = [];
const url = board => new URL(board ? `/mcp?board=${board}` : '/mcp', origin);
async function connect(board, credential) {
  const client = new Client({ name: 'bloom-cloudflare-smoke', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(url(board), { requestInit: { headers: { Authorization: `Bearer ${credential}` } } }));
  return client;
}
const value = result => { assert.ok(!result.isError, result.content?.[0]?.text); return JSON.parse(result.content[0].text); };
async function denied(board, credential) {
  const response = await fetch(url(board), { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 401);
}
let created = false;
const connectionOwner = `connection-${id}`, secondId = `${id}-second`;
try {
  await query('INSERT INTO boards (id, owner, graph, updated, agent_hash, agent_enabled) VALUES (?, ?, ?, ?, ?, 1)', [id, 'smoke-test', JSON.stringify(graph), Date.now(), digest(token)]);
  created = true;
  await denied(id, '0'.repeat(64));
  await denied('missing-board', token);
  const client = await connect(id, token);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), ['edit_board', 'get_board', 'get_board_image', 'list_boards']);
  assert.equal(value(await client.callTool({ name: 'get_board', arguments: {} })).revision, 0);
  const edited = value(await client.callTool({ name: 'edit_board', arguments: { expectedRevision: 0, operations: [{ type: 'addNode', id: 'test-child', parent: graph.nodes[0].id, text: 'Live MCP test' }] } }));
  assert.equal(edited.revision, 1);
  assert.equal(edited.previousRevision, 0);
  assert.equal(edited.added.nodes.length, 1);
  assert.equal(edited.added.nodes[0].id, 'test-child');
  assert.equal(edited.added.edges.length, 1);
  assert.ok(!('graph' in edited));
  const compact = value(await client.callTool({ name: 'get_board', arguments: {} }));
  assert.deepEqual(Object.keys(compact.graph.nodes[0]).sort(), ['id', 'text']);
  assert.ok(!('members' in compact) && !('activity' in compact));
  const targeted = value(await client.callTool({ name: 'get_board', arguments: { nodeIds: ['test-child', 'absent'], includeLayout: true } }));
  assert.deepEqual(targeted.graph.nodes, edited.added.nodes);
  assert.deepEqual(targeted.graph.edges, edited.added.edges);
  assert.deepEqual(targeted.scope.missingNodeIds, ['absent']);
  assert.deepEqual(targeted.scope.boundaryNodeIds, [graph.nodes[0].id]);
  assert.equal(targeted.scope.partial, true);
  const detailed = value(await client.callTool({ name: 'get_board', arguments: { view: 'full' } }));
  assert.equal(detailed.graph.nodes.length, 2);
  assert.ok(Array.isArray(detailed.members) && Array.isArray(detailed.activity));
  const optional = value(await client.callTool({ name: 'get_board', arguments: { includeActivity: true, includeParticipants: true } }));
  assert.ok(optional.activity.length > 0 && Array.isArray(optional.members));
  const invalid = await client.callTool({ name: 'edit_board', arguments: { expectedRevision: 1, operations: [{ type: 'addNode', id: 'rollback' }, { type: 'addNode', parent: 'missing' }] } });
  assert.equal(invalid.isError, true);
  const rollback = value(await client.callTool({ name: 'get_board', arguments: { nodeIds: ['rollback'] } }));
  assert.equal(rollback.revision, 1); assert.deepEqual(rollback.scope.missingNodeIds, ['rollback']);
  const conflict = await client.callTool({ name: 'edit_board', arguments: { expectedRevision: 0, operations: [{ type: 'rename', title: 'Must not apply' }] } });
  assert.equal(conflict.isError, true);
  assert.equal(value(await client.callTool({ name: 'get_board', arguments: {} })).graph.title, graph.title);
  assert.equal((await client.callTool({ name: 'get_board', arguments: { boardId: 'missing-board' } })).isError, true);
  assert.equal((await client.readResource({ uri: 'bloom://board/canvas' })).contents.length, 1);
  assert.equal((await client.callTool({ name: 'get_board_image', arguments: {} })).isError, true);
  const writes = await Promise.all(['A', 'B'].map(title => client.callTool({ name: 'edit_board', arguments: { expectedRevision: 1, operations: [{ type: 'rename', title }] } })));
  assert.equal(writes.filter(r => !r.isError).length, 1);
  assert.equal(value(await client.callTool({ name: 'get_board', arguments: {} })).revision, 2);
  const fullEdit = value(await client.callTool({ name: 'edit_board', arguments: { expectedRevision: 2, response: 'full', operations: [{ type: 'updateNode', id: 'test-child', x: 12 }] } }));
  assert.equal(fullEdit.revision, 3); assert.equal(fullEdit.graph.nodes.find(n => n.id === 'test-child').x, 12);
  const layoutConflict = await client.callTool({ name: 'edit_board', arguments: { expectedRevision: 2, operations: [{ type: 'updateNode', id: 'test-child', text: 'Must not overwrite' }] } });
  assert.equal(layoutConflict.isError, true);
  await query('UPDATE boards SET agent_enabled = 0 WHERE id = ?', [id]);
  await denied(id, token);
  const rotated = randomBytes(32).toString('hex');
  await query('UPDATE boards SET agent_enabled = 1, agent_hash = ? WHERE id = ?', [digest(rotated), id]);
  await denied(id, token);
  const replacement = await connect(id, rotated);
  assert.equal(value(await replacement.callTool({ name: 'get_board', arguments: {} })).revision, 3);
  await query('UPDATE boards SET agent_enabled = 0, agent_hash = NULL WHERE id = ?', [id]);
  await denied(id, rotated);
  const rejectedOrigin = await fetch(url(id), { method: 'POST', headers: { Origin: 'https://untrusted.example', Authorization: `Bearer ${token}` } });
  assert.equal(rejectedOrigin.status, 403);
  for (const path of ['/', '/api/boards', '/canvas/app.js']) {
    const response = await fetch(config.vars.BROWSER_ORIGIN + path, { redirect: 'manual', headers: { 'oai-authenticated-user-id': 'email:theothersam@gmail.com' } });
    assert.ok([302, 401, 403, 503].includes(response.status), `Human authentication gate failed on ${path}: ${response.status}`);
  }
  const connectionKey = 'bloom_agent_' + randomBytes(32).toString('hex');
  const secondToken = randomBytes(32).toString('hex');
  await query('INSERT INTO agent_connections (owner, token_hash, created) VALUES (?, ?, ?)', [connectionOwner, digest(connectionKey), Date.now()]);
  await query('UPDATE boards SET agent_enabled = 1, agent_hash = ? WHERE id = ?', [digest(token), id]);
  await query('INSERT INTO boards (id, owner, graph, updated, agent_hash, agent_enabled) VALUES (?, ?, ?, ?, ?, 1)', [secondId, 'another-owner', JSON.stringify(graph), Date.now(), digest(secondToken)]);
  const general = await connect(null, connectionKey);
  assert.equal((await general.listTools()).tools.length, 5);
  assert.deepEqual(value(await general.callTool({ name: 'list_boards', arguments: {} })), []);
  assert.equal((await general.callTool({ name: 'get_board', arguments: { boardId: id } })).isError, true);
  assert.equal((await general.callTool({ name: 'claim_board', arguments: { code: 'bloom_invalid' } })).isError, true);
  for (let i = 0; i < 2; i++) assert.equal(value(await general.callTool({ name: 'claim_board', arguments: { code: boardCode(token) } })).boardId, id);
  assert.equal(value(await general.callTool({ name: 'get_board', arguments: { boardId: id } })).boardId, id);
  const resumed = await connect(null, connectionKey);
  assert.equal(value(await resumed.callTool({ name: 'list_boards', arguments: {} })).length, 1);
  assert.equal(value(await resumed.callTool({ name: 'claim_board', arguments: { code: boardCode(secondToken) } })).boardId, secondId);
  assert.equal(value(await resumed.callTool({ name: 'list_boards', arguments: {} })).length, 2);
  const claimedEdit = value(await resumed.callTool({ name: 'edit_board', arguments: { boardId: secondId, expectedRevision: 0, operations: [{ type: 'rename', title: 'Persistent grant edit' }] } }));
  assert.equal(claimedEdit.revision, 1);
  const call = async (name, args) => value(await resumed.callTool({ name, arguments: { boardId: secondId, ...args } }));
  const rootId = graph.nodes[0].id;
  const moved = await call('edit_board', { expectedLayoutRevision: claimedEdit.layoutRevision, operations: [{ type: 'updateNode', id: rootId, x: 123 }] });
  assert.equal(moved.contentRevision, claimedEdit.contentRevision);
  const content = await call('edit_board', { expectedContentRevision: claimedEdit.contentRevision, operations: [{ type: 'updateNode', id: rootId, text: 'Content after concurrent move' }] });
  assert.equal(content.updated.nodes[0].x, 123);
  assert.equal(content.layoutRevision, moved.layoutRevision);
  for (const [precondition, operation] of [
    [{ expectedContentRevision: claimedEdit.contentRevision }, { type: 'rename', title: 'Stale content' }],
    [{ expectedLayoutRevision: claimedEdit.layoutRevision }, { type: 'updateNode', id: rootId, x: -12 }],
    [{ expectedContentRevision: content.contentRevision }, { type: 'updateNode', id: rootId, x: -12 }],
  ]) assert.equal((await resumed.callTool({ name: 'edit_board', arguments: { boardId: secondId, ...precondition, operations: [operation] } })).isError, true);
  const raced = await Promise.all([
    call('edit_board', { expectedContentRevision: content.contentRevision, operations: [{ type: 'updateNode', id: rootId, text: 'Concurrent content' }] }),
    call('edit_board', { expectedLayoutRevision: content.layoutRevision, operations: [{ type: 'updateNode', id: rootId, y: 456 }] }),
  ]);
  assert.equal(new Set(raced.map(r => r.revision)).size, 2);
  const merged = await call('get_board', { includeLayout: true });
  assert.equal(merged.graph.nodes[0].text, 'Concurrent content'); assert.equal(merged.graph.nodes[0].y, 456); assert.equal(merged.graph.nodes[0].x, 123);
  const changes = await call('get_board', { sinceRevision: claimedEdit.revision });
  assert.equal(changes.fromRevision, 1); assert.equal(changes.revision, merged.revision); assert.equal(changes.resyncRequired, false);
  assert.deepEqual(changes.updated.nodes, merged.graph.nodes);
  const branch = await call('edit_board', { expectedContentRevision: merged.contentRevision, operations: [
    { type: 'addNode', id: 'branch', parent: rootId, text: 'Branch' }, { type: 'addNode', id: 'leaf', parent: 'branch', text: 'Leaf' },
    { type: 'connect', source: 'branch', target: 'leaf', style: 'reverse' },
  ] });
  assert.equal(branch.added.edges.find(e => e.target === 'leaf').type, 'reverse');
  const removed = await call('edit_board', { expectedContentRevision: branch.contentRevision, operations: [{ type: 'deleteNodes', ids: ['leaf'] }] });
  assert.deepEqual(removed.removed.nodeIds, ['leaf']); assert.equal(removed.removed.edgeIds.length, 1);
  const deletion = await call('get_board', { sinceRevision: branch.revision });
  assert.deepEqual(deletion.removed, removed.removed);
  const empty = await call('get_board', { sinceRevision: removed.revision });
  assert.deepEqual(empty.added, { nodes: [], edges: [] }); assert.deepEqual(empty.updated, { nodes: [], edges: [] });
  assert.equal(empty.revision, removed.revision);
  assert.equal((await resumed.callTool({ name: 'get_board', arguments: { boardId: secondId, sinceRevision: removed.revision + 1 } })).isError, true);
  assert.equal((await resumed.callTool({ name: 'get_board', arguments: { boardId: secondId, sinceRevision: 0, nodeIds: ['branch'] } })).isError, true);
  await query('DELETE FROM changes WHERE board_id = ? AND revision = 0', [secondId]);
  assert.equal((await call('get_board', { sinceRevision: 0 })).resyncRequired, true);
  const finalRevision = removed.revision;
  console.log('PASS: independent content/layout preconditions, concurrent merge, stale/unsafe edits rejected, since-revision deltas, deletion cascades, empty/future/expired cursors and reverse arrows.');

  await query('UPDATE boards SET agent_hash = NULL, agent_enabled = 0 WHERE id = ?', [id]);
  assert.equal((await resumed.callTool({ name: 'get_board', arguments: { boardId: id } })).isError, true);
  assert.equal(value(await resumed.callTool({ name: 'list_boards', arguments: {} })).length, 1);
  const nextCodeToken = randomBytes(32).toString('hex');
  await query('UPDATE boards SET agent_hash = ? WHERE id = ?', [digest(nextCodeToken), secondId]);
  assert.equal((await resumed.callTool({ name: 'get_board', arguments: { boardId: secondId } })).isError, true);
  assert.equal((await resumed.callTool({ name: 'claim_board', arguments: { code: boardCode(secondToken) } })).isError, true);
  value(await resumed.callTool({ name: 'claim_board', arguments: { code: boardCode(nextCodeToken) } }));
  await query('UPDATE boards SET agent_enabled = 0 WHERE id = ?', [secondId]);
  assert.equal((await resumed.callTool({ name: 'get_board', arguments: { boardId: secondId } })).isError, true);
  await query('UPDATE boards SET agent_enabled = 1 WHERE id = ?', [secondId]);
  const replacementKey = 'bloom_agent_' + randomBytes(32).toString('hex');
  await query('UPDATE agent_connections SET token_hash = ? WHERE owner = ?', [digest(replacementKey), connectionOwner]);
  await denied(null, connectionKey);
  const refreshed = await connect(null, replacementKey);
  assert.equal(value(await refreshed.callTool({ name: 'get_board', arguments: { boardId: secondId } })).revision, finalRevision);
  console.log('PASS: permanent connection, empty initial permissions, short-code claim, idempotence, reconnect persistence, two boards, writes, independent revocation, code replacement, pause and connection-key rotation.');
  console.log('PASS: compact defaults, targeted reads, layout/activity opt-ins, exact edit deltas, full compatibility, atomic rollback and layout conflict protection.');
  console.log('PASS: deployed SDK discovery, graph read/edit, concurrent and stale revisions, JSON Canvas, missing screenshot, board scoping, pause, rotation, revocation, Origin rejection and human authentication gate.');
} finally {
  await Promise.allSettled(clients.map(c => c.close()));
  if (created) {
    await query('DELETE FROM agent_grants WHERE owner = ?', [connectionOwner]);
    await query('DELETE FROM agent_connections WHERE owner = ?', [connectionOwner]);
    await query('DELETE FROM changes WHERE board_id = ?', [secondId]);
    await query('DELETE FROM boards WHERE id = ?', [secondId]);
    await query('DELETE FROM changes WHERE board_id = ?', [id]);
    await query('DELETE FROM members WHERE board_id = ?', [id]);
    await query('DELETE FROM boards WHERE id = ?', [id]);
    console.log('Temporary test board removed.');
  }
}
