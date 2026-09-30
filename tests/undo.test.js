import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { withIdentity } from '../web/lib/identity.js';
import { newGraph, GraphStore } from '../web/lib/graph.js';
import { diffGraphs, applyPatch } from '../web/lib/undo.js';

const change = (graph, ops) => { const store = new GraphStore(graph); store.apply(ops); return store.graph; };
const node = (graph, id) => graph.nodes.find(n => n.id === id);

test('undo returns only what still looks the way the change left it', () => {
  const start = newGraph(true), [root, a, b] = start.nodes.map(n => n.id);
  // Alice renamed an idea, then Bob moved it and retitled the board.
  const mine = change(start, [{ type: 'updateNode', id: a, text: 'Mine' }]), patch = diffGraphs(start, mine);
  let now = change(mine, [{ type: 'updateNode', id: a, x: 999 }, { type: 'rename', title: 'Bob’s title' }]);
  let result = applyPatch(now, patch);
  assert.equal(node(result.graph, a).text, start.nodes[1].text);
  assert.equal(node(result.graph, a).x, 999); assert.equal(result.graph.title, 'Bob’s title');
  assert.deepEqual([result.applied, result.skipped], [1, 0]);
  assert.deepEqual(applyPatch(result.graph, patch, 'redo').graph, now, 'redo puts it back');
  // Bob has since retyped the same idea: Alice's undo leaves his words.
  now = change(mine, [{ type: 'updateNode', id: a, text: 'Bob’s words' }]);
  result = applyPatch(now, patch);
  assert.equal(node(result.graph, a).text, 'Bob’s words'); assert.deepEqual([result.applied, result.skipped], [0, 1]);

  // An added idea and its connection are removed, unless someone has connected to it since.
  const added = change(start, [{ type: 'addNode', id: 'new', parent: a, text: 'New' }]), addPatch = diffGraphs(start, added);
  assert.deepEqual(applyPatch(added, addPatch).graph, start);
  const linked = change(added, [{ type: 'connect', source: b, target: 'new' }]);
  result = applyPatch(linked, addPatch);
  assert.ok(node(result.graph, 'new'), 'kept because Bob connected to it');
  assert.equal(result.graph.edges.filter(e => e.target === 'new').length, 1, 'only Alice’s own connection went');

  // Deleted ideas come back with their connections, except to ideas that are gone now.
  const deleted = change(start, [{ type: 'deleteNodes', ids: [a] }]), deletePatch = diffGraphs(start, deleted);
  assert.deepEqual(applyPatch(deleted, deletePatch).graph.nodes.map(n => n.id).sort(), start.nodes.map(n => n.id).sort());
  const leafOfA = start.edges.find(e => e.source === a).target;
  result = applyPatch(change(deleted, [{ type: 'deleteNodes', ids: [leafOfA] }]), deletePatch);
  assert.ok(node(result.graph, a)); assert.ok(!result.graph.edges.some(e => e.target === leafOfA));
  assert.ok(result.graph.edges.some(e => e.source === root && e.target === a));
});

test('each person undoes and redoes only their own changes on a shared board', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync('web/drizzle').filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(`web/drizzle/${file}`, 'utf8'));
  const db = {
    prepare(query) { return { bind(...args) { const stmt = sql.prepare(query); return {
      first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }), run: async () => ({ meta: stmt.run(...args) })
    }; } }; },
    async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } }
  };
  globalThis.__bloomUndoEnv = { DB: db };
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier === 'cloudflare:workers' ? { url: 'data:text/javascript,export const env = globalThis.__bloomUndoEnv;', shortCircuit: true } : next(specifier, context); } });
  try {
    const { handleApi, changeBoard } = await import('../web/lib/boards.js');
    const alice = { userId: 'alice', displayName: 'Alice' }, bob = { userId: 'bob', displayName: 'Bob' };
    const api = (who, segments, body) => withIdentity(who, () => handleApi(new Request(`https://bloom.test/api/${segments.join('/')}`, body === undefined ? {} : { method: 'POST', headers: { Origin: 'https://bloom.test' }, body: JSON.stringify(body) }), segments));
    const { id } = await api(alice, ['boards'], { graph: newGraph(true) });
    sql.prepare('INSERT INTO members (board_id, user_id, name, role, seen) VALUES (?, ?, ?, ?, 0)').run(id, 'bob', 'Bob', 'editor');
    const board = () => sql.prepare('SELECT * FROM boards WHERE id = ?').get(id), graph = () => JSON.parse(board().graph);
    const edit = (who, operations) => api(who, ['boards', id, 'edit'], { baseRevision: board().revision, operations });
    const undo = who => api(who, ['boards', id, 'edit'], { action: 'undo' }), redo = who => api(who, ['boards', id, 'edit'], { action: 'redo' });
    const [, a] = graph().nodes.map(n => n.id);

    await edit(alice, [{ type: 'rename', title: 'Alice’s title' }]);
    await edit(bob, [{ type: 'addNode', id: 'bobs', parent: a, text: 'Bob’s idea' }]);
    const afterUndo = await undo(alice);
    assert.equal(graph().title, 'Untitled brainstorm');
    assert.ok(node(graph(), 'bobs'), 'Bob’s newer idea stays');
    assert.deepEqual([afterUndo.canUndo, afterUndo.canRedo], [false, true]);
    const bobView = await api(bob, ['boards', id]);
    assert.deepEqual([bobView.canUndo, bobView.canRedo], [true, false], 'Bob’s history is his own');
    await assert.rejects(undo(alice), { status: 400, message: /Nothing to undo/ });
    await redo(alice); assert.equal(graph().title, 'Alice’s title');
    await undo(bob); assert.ok(!node(graph(), 'bobs')); assert.equal(graph().title, 'Alice’s title');

    // A new change ends what you could redo; other people's undo history is untouched.
    await undo(alice); await edit(alice, [{ type: 'updateNode', id: a, color: '#64a7e5' }]);
    await assert.rejects(redo(alice), { status: 400, message: /Nothing to redo/ });
    assert.equal((await api(bob, ['boards', id])).canRedo, true);

    // If others have changed everything a step touched, undo says so and moves on to the one before.
    await edit(bob, [{ type: 'updateNode', id: a, color: '#f3af47' }]);
    const revision = board().revision, skipped = await undo(alice);
    assert.equal(board().revision, revision); assert.match(skipped.notice, /nothing to undo/);
    assert.equal(node(graph(), a).color, '#f3af47');

    // An agent working through Alice's connection key adds to Alice's undo history.
    await changeBoard(board(), { userId: 'agent', displayName: 'AI collaborator', undoOwner: 'alice' }, 'agent', { operations: [{ type: 'addNode', id: 'agent-idea', parent: a }], expectedRevision: board().revision }, 'delta');
    await undo(alice); assert.ok(!node(graph(), 'agent-idea'));
    assert.equal(sql.prepare("SELECT kind FROM changes ORDER BY revision DESC LIMIT 1").get().kind, 'Undid a shared change');
  } finally { hooks.deregister(); delete globalThis.__bloomUndoEnv; }
});
