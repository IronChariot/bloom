import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { withIdentity } from '../web/lib/identity.js';
import { newGraph } from '../web/lib/graph.js';

test('browser edits replay on the latest board and only conflict with what they touch', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync('web/drizzle').filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(`web/drizzle/${file}`, 'utf8'));
  let beforeBatch;
  const db = {
    prepare(query) { return { bind(...args) { const stmt = sql.prepare(query); return {
      first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }), run: async () => ({ meta: stmt.run(...args) })
    }; } }; },
    async batch(statements) { if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook(); } sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } }
  };
  globalThis.__bloomRebaseEnv = { DB: db };
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier === 'cloudflare:workers' ? { url: 'data:text/javascript,export const env = globalThis.__bloomRebaseEnv;', shortCircuit: true } : next(specifier, context); } });
  try {
    const { handleApi } = await import('../web/lib/boards.js');
    const alice = { userId: 'alice', displayName: 'Alice' }, bob = { userId: 'bob', displayName: 'Bob' };
    const api = (who, segments, body) => withIdentity(who, () => handleApi(new Request(`https://bloom.test/api/${segments.join('/')}`, body === undefined ? {} : { method: 'POST', headers: { Origin: 'https://bloom.test' }, body: JSON.stringify(body) }), segments));
    const { id } = await api(alice, ['boards'], { graph: newGraph(true) });
    sql.prepare('INSERT INTO members (board_id, user_id, name, role, seen) VALUES (?, ?, ?, ?, 0)').run(id, 'bob', 'Bob', 'editor');
    const board = () => sql.prepare('SELECT * FROM boards WHERE id = ?').get(id);
    const node = nodeId => JSON.parse(board().graph).nodes.find(n => n.id === nodeId);
    const [a, b, c, d] = JSON.parse(board().graph).nodes.slice(1).map(n => n.id);
    const edit = (who, operations, extra) => api(who, ['boards', id, 'edit'], { operations, ...extra });

    // Alice read the board, then Bob made unrelated content and layout changes.
    const base = board().revision;
    await edit(bob, [{ type: 'updateNode', id: a, text: 'Bob’s words' }], { baseRevision: base });
    await edit(bob, [{ type: 'updateNode', id: b, x: 500, y: 500, before: { x: node(b).x, y: node(b).y } }], { baseRevision: base + 1 });
    const saved = await edit(alice, [{ type: 'colorNodes', ids: [c], color: '#64a7e5' }, { type: 'updateNode', id: b, x: -10, y: -20, before: { x: 0, y: 0 } }], { baseRevision: base });
    assert.equal(saved.revision, base + 3);
    assert.equal(node(a).text, 'Bob’s words', 'the unrelated text edit survives');
    assert.equal(node(c).color, '#64a7e5');
    assert.deepEqual([node(b).x, node(b).y], [-10, -20], 'the later move wins');
    assert.equal(saved.skipped, undefined);

    // Targets someone else removed are skipped and reported, and the rest still applies.
    await edit(bob, [{ type: 'deleteNodes', ids: [d] }], { baseRevision: base });
    const partial = await edit(alice, [{ type: 'colorNodes', ids: [c, d], color: '#f3af47' }], { baseRevision: base });
    assert.equal(node(c).color, '#f3af47');
    assert.deepEqual(partial.skipped, [{ type: 'colorNodes', ids: [d] }]);
    const revision = board().revision;
    const nothing = await edit(alice, [{ type: 'updateNode', id: d, text: 'Gone' }, { type: 'deleteNodes', ids: [d] }], { baseRevision: base });
    assert.equal(board().revision, revision, 'an edit that only touched removed ideas saves nothing');
    assert.equal(nothing.revision, revision);
    assert.equal(nothing.skipped.length, 2);

    // Real conflicts still stop the edit with a readable reason.
    await assert.rejects(edit(alice, [{ type: 'updateNode', id: a, text: 'Alice’s words', before: { text: 'Something\nplayful' } }], { baseRevision: base }), { status: 409, message: /changed while you were editing/ });
    await assert.rejects(edit(alice, [{ type: 'addNode', parent: d, text: 'Orphan' }], { baseRevision: base }), { status: 409, message: /does not exist/ });
    await assert.rejects(edit(alice, [{ type: 'rename', title: 'Later' }], { baseRevision: board().revision + 1 }), { status: 409, message: /baseRevision/ });
    await assert.rejects(edit(alice, [{ type: 'rename', title: 'Stale' }], { expectedRevision: base }), { status: 409 }, 'the strict check is unchanged');

    // A write that lands between reading the board and saving is replayed, not reported.
    beforeBatch = () => edit(bob, [{ type: 'updateNode', id: a, text: 'Racing words' }], { baseRevision: board().revision });
    await edit(alice, [{ type: 'rename', title: 'Renamed during a race' }], { baseRevision: base });
    assert.equal(JSON.parse(board().graph).title, 'Renamed during a race');
    assert.equal(node(a).text, 'Racing words');
  } finally { hooks.deregister(); delete globalThis.__bloomRebaseEnv; }
});
