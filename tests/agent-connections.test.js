import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { withIdentity } from '../web/lib/identity.js';
import { newGraph } from '../web/lib/graph.js';
import { boardCode } from '../web/public/canvas/agent-code.js';

test('named connection keys are separate, and agent access follows board membership', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync('web/drizzle').filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(`web/drizzle/${file}`, 'utf8'));
  const db = {
    prepare(query) { return { bind(...args) { const stmt = sql.prepare(query); return {
      first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }), run: async () => ({ meta: stmt.run(...args) })
    }; } }; },
    async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; } catch (e) { sql.exec('ROLLBACK'); throw e; } }
  };
  globalThis.__bloomAgentEnv = { DB: db, AGENT_CODE_KEY: 'ab'.repeat(32) };
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier === 'cloudflare:workers' ? { url: 'data:text/javascript,export const env = globalThis.__bloomAgentEnv;', shortCircuit: true } : next(specifier, context); } });
  try {
    const { handleApi, agentConnection, claimAgentBoard, listAgentBoards, accessAgentBoard } = await import('../web/lib/boards.js');
    const alice = { userId: 'alice', displayName: 'Alice' }, bob = { userId: 'bob', displayName: 'Bob' }, carol = { userId: 'carol', displayName: 'Carol' };
    const api = (who, segments, body) => withIdentity(who, () => handleApi(new Request(`https://bloom.test/api/${segments.join('/')}`, body === undefined ? {} : { method: 'POST', headers: { Origin: 'https://bloom.test' }, body: JSON.stringify(body) }), segments));
    const connect = key => agentConnection(new Request('https://bloom-mcp.test/mcp', { headers: { Authorization: `Bearer ${key}` } }));

    const { id } = await api(alice, ['boards'], { graph: newGraph(true) });
    sql.prepare('INSERT INTO members (board_id, user_id, name, role, seen) VALUES (?, ?, ?, ?, 0)').run(id, 'bob', 'Bob', 'editor');

    // One account holds several named keys, and each one is usable on its own.
    const hermes = await api(alice, ['agent-connection'], { label: 'Hermes on the mini PC' });
    const claude = await api(alice, ['agent-connection'], { label: '  Claude   Code  ' });
    assert.notEqual(hermes.token, claude.token);
    assert.deepEqual(claude.connections.map(c => c.label), ['Hermes on the mini PC', 'Claude Code']);
    assert.equal((await connect(hermes.token)).owner, 'alice');
    assert.equal((await connect(claude.token)).owner, 'alice');
    await assert.rejects(api(alice, ['agent-connection'], { label: '   ' }), /Name this connection/);
    assert.deepEqual((await api(alice, ['agent-connection'])).connections.map(c => c.label), ['Hermes on the mini PC', 'Claude Code']);

    // Revoking one key leaves the other connected, and no other account can revoke it.
    await assert.rejects(api(bob, ['agent-connection'], { revoke: hermes.connections[0].id }), { status: 404 });
    const left = await api(alice, ['agent-connection'], { revoke: claude.connections.at(-1).id });
    assert.deepEqual(left.connections.map(c => c.label), ['Hermes on the mini PC']);
    assert.ok(!await connect(claude.token), 'a revoked key stops working');
    assert.equal((await connect(hermes.token)).owner, 'alice');

    // Any member copies the same board code; only the owner pauses, revokes or replaces it.
    const owned = await api(alice, ['boards', id, 'agent'], { reuse: true });
    const shared = await api(bob, ['boards', id, 'agent'], { reuse: true });
    assert.equal(shared.token, owned.token);
    for (const body of [{ revoke: true }, { enabled: false }, {}, { reuse: true, revoke: true }, { reuse: true, enabled: false }])
      await assert.rejects(api(bob, ['boards', id, 'agent'], body), { status: 403 });
    assert.equal(sql.prepare('SELECT agent_enabled FROM boards WHERE id = ?').get(id).agent_enabled, 1);

    // Bob's own key claims the board that Bob can already open; a stranger's key cannot.
    const bobKey = await api(bob, ['agent-connection'], { label: 'Bob’s Claude Code' });
    const carolKey = await api(carol, ['agent-connection'], { label: 'Carol’s agent' });
    const code = boardCode(owned.token);
    assert.equal((await claimAgentBoard('bob', code)).boardId, id);
    await assert.rejects(claimAgentBoard('carol', code), { status: 403 });
    assert.equal((await connect(bobKey.token)).owner, 'bob');
    assert.equal((await connect(carolKey.token)).owner, 'carol');
    assert.deepEqual((await listAgentBoards('bob')).map(b => b.id), [id]);
    assert.deepEqual(await listAgentBoards('carol'), []);
    assert.equal((await accessAgentBoard('bob', id)).board.id, id);

    // Removing Bob from the board also stops Bob's agents, without touching the grant of the owner.
    await claimAgentBoard('alice', code);
    await api(alice, ['boards', id, 'member'], { userId: 'bob' });
    assert.deepEqual(await listAgentBoards('bob'), []);
    await assert.rejects(accessAgentBoard('bob', id), { status: 403 });
    assert.deepEqual((await listAgentBoards('alice')).map(b => b.id), [id]);
    assert.equal((await accessAgentBoard('alice', id)).board.id, id);

    // A paused board stops every agent, whichever key it uses.
    await api(alice, ['boards', id, 'agent'], { enabled: false });
    assert.deepEqual(await listAgentBoards('alice'), []);
    await assert.rejects(accessAgentBoard('alice', id), { status: 403 });
    await assert.rejects(claimAgentBoard('alice', code), { status: 403 });
    console.log('PASS: separate named keys, member code copies and membership-scoped agent grants');
  } finally { hooks.deregister(); delete globalThis.__bloomAgentEnv; sql.close(); }
});
