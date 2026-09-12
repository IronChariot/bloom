import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore, newGraph } from '../web/lib/graph.js';
import { readView, editDelta } from '../web/lib/agent-views.js';

const board = (graph, revision = 4) => ({ id: 'board', revision, graph: JSON.stringify(graph) });
test('compact and targeted reads retain stable references and identify missing/outside nodes', () => {
  const graph = newGraph(true), leaf = graph.nodes.at(-1);
  const compact = readView(board(graph));
  assert.deepEqual(compact.graph.nodes[0], { id: graph.nodes[0].id, text: graph.nodes[0].text });
  assert.deepEqual(compact.graph.edges, graph.edges);
  assert.equal(compact.revision, 4);
  assert.ok(!('activity' in compact));
  const target = readView(board(graph), { nodeIds: [leaf.id, 'missing', leaf.id] });
  assert.equal(target.graph.nodes.length, 1);
  assert.deepEqual(target.graph.edges, graph.edges.filter(e => e.source === leaf.id || e.target === leaf.id));
  assert.deepEqual(target.scope.missingNodeIds, ['missing']);
  assert.equal(target.scope.partial, true);
  assert.deepEqual(target.scope.boundaryNodeIds, [graph.edges.at(-1).source]);
  assert.deepEqual(readView(board(graph), { includeLayout: true }).graph.nodes, graph.nodes);
  assert.deepEqual(readView(board(graph), { view: 'full' }).graph, graph);
});

test('deltas account for batches, changed edge styles, deletion cascades and title changes', () => {
  const store = new GraphStore(newGraph(true)), before = structuredClone(store.graph);
  const edge = before.edges[0], removed = before.nodes.at(-1).id;
  store.apply([
    { type: 'addNode', id: 'plan', text: 'Plan', parent: before.nodes[0].id },
    { type: 'addNode', id: 'child', text: 'Step', parent: 'plan' },
    { type: 'updateNode', id: before.nodes[1].id, text: 'Revised', x: 5 },
    { type: 'connect', source: edge.source, target: edge.target, style: 'dotted' },
    { type: 'deleteNodes', ids: [removed] }, { type: 'rename', title: 'Updated title' },
  ], 'AI', 0);
  const delta = editDelta('board', 0, before, store.graph);
  assert.equal(delta.previousRevision, 0); assert.equal(delta.revision, 1);
  assert.deepEqual(delta.added.nodes.map(n => n.id), ['plan', 'child']);
  assert.equal(delta.added.nodes[1].depth, delta.added.nodes[0].depth + 1);
  assert.ok(Number.isFinite(delta.added.nodes[1].x));
  assert.equal(delta.added.edges.length, 2);
  assert.deepEqual(delta.updated.nodes.map(n => n.id), [before.nodes[1].id]);
  assert.deepEqual(delta.updated.edges, [{ ...edge, type: 'dotted' }]);
  assert.deepEqual(delta.removed.nodeIds, [removed]);
  assert.deepEqual(delta.removed.edgeIds, [before.edges.at(-1).id]);
  assert.equal(delta.title, 'Updated title');
  // Applying the receipt to the previously read full graph reproduces the commit.
  const apply = (old, added, updated, removed) => old.filter(e => !removed.includes(e.id)).map(e => updated.find(u => u.id === e.id) || e).concat(added);
  assert.deepEqual({ ...before, title: delta.title,
    nodes: apply(before.nodes, delta.added.nodes, delta.updated.nodes, delta.removed.nodeIds),
    edges: apply(before.edges, delta.added.edges, delta.updated.edges, delta.removed.edgeIds),
  }, store.graph);
});

test('batch failure and layout-only conflicts do not partially apply semantic edits', () => {
  const store = new GraphStore(newGraph()), before = structuredClone(store.graph);
  assert.throws(() => store.apply([{ type: 'addNode', id: 'ok', text: 'Temporary' }, { type: 'addNode', parent: 'missing' }], 'AI', 0));
  assert.deepEqual(store.graph, before); assert.equal(store.revision, 0);
  store.apply([{ type: 'updateNode', id: before.nodes[0].id, x: 42 }], 'Human', 0);
  assert.throws(() => store.apply([{ type: 'rename', title: 'Stale' }], 'AI', 0), /changed/);
  assert.equal(store.graph.title, before.title);
});

test('compact read, delta and targeted verification substantially reduce response bytes', () => {
  const store = new GraphStore(newGraph());
  store.apply(Array.from({ length: 14 }, (_, i) => ({ type: 'addNode', text: `A useful brainstorm idea ${i}`, parent: store.graph.nodes[0].id })), 'AI', 0);
  const before = structuredClone(store.graph), fullBefore = store.snapshot();
  store.apply([{ type: 'addNode', id: 'next-step', text: 'Try a small prototype', parent: before.nodes[0].id }], 'AI', 1);
  const bytes = obj => Buffer.byteLength(JSON.stringify(obj));
  const oldBytes = bytes(fullBefore) + 2 * bytes(store.snapshot());
  const newBytes = bytes(readView(board(before, 1))) + bytes(editDelta('board', 1, before, store.graph)) + bytes(readView(board(store.graph, 2), { nodeIds: ['next-step'] }));
  assert.ok(newBytes < oldBytes * .5);
  console.log(`Synthetic 15-node read/edit/verify: ${oldBytes} -> ${newBytes} UTF-8 response bytes (${Math.round((1 - newBytes / oldBytes) * 100)}% smaller). Not token billing.`);
});
