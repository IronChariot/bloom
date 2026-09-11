import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore, newGraph, validateGraph, toCanvas, fromCanvas, mixColors } from '../src/graph.js';

test('atomic edits reject stale revisions and roll back failed batches', () => {
  const store = new GraphStore(newGraph()); const root = store.graph.nodes[0].id;
  store.apply([{ type: 'addNode', id: 'child', parent: root, text: 'A thought' }], 'Agent', 0);
  assert.equal(store.graph.nodes.length, 2);
  assert.throws(() => store.apply([{ type: 'updateNode', id: root, text: 'Stale' }], 'Agent', 0), /Board changed/);
  assert.throws(() => store.apply([{ type: 'updateNode', id: root, text: 'Partial' }, { type: 'connect', source: root, target: 'missing' }]), /does not exist/);
  assert.equal(store.graph.nodes[0].text, 'Your big idea'); assert.equal(store.revision, 1);
});
test('branches inherit colour, links preserve colours, delete preserves graph integrity and undo restores it', () => {
  const store = new GraphStore(newGraph()); const root = store.graph.nodes[0].id;
  store.apply([{ type: 'addNode', id: 'a', parent: root }, { type: 'addNode', id: 'b', parent: root }, { type: 'addNode', id: 'c', parent: 'a' }]);
  const [r, a, b, c] = store.graph.nodes;
  assert.equal(r.color, '#ffffff'); assert.notEqual(a.color, b.color); assert.notEqual(a.color, c.color);
  store.apply([{ type: 'connect', source: 'b', target: 'c', style: 'both' }]); assert.deepEqual(store.graph.nodes.map(n => n.color), [r, a, b, c].map(n => n.color));
  store.apply([{ type: 'deleteNodes', ids: ['a'] }]); assert.equal(store.graph.edges.length, 2); validateGraph(store.graph);
  store.undo(); assert.equal(store.graph.nodes.length, 4); assert.equal(store.graph.edges.length, 4);
  store.redo(); assert.equal(store.graph.nodes.length, 3);
});
test('generation is inherited on creation and survives cross-links and file roundtrips', () => {
  const store = new GraphStore(newGraph()); const root = store.graph.nodes[0].id;
  store.apply([{ type: 'addNode', id: 'one', parent: root }, { type: 'addNode', id: 'two', parent: 'one' }, { type: 'addNode', id: 'three', parent: 'two' }]);
  assert.deepEqual(store.graph.nodes.map(n => n.depth), [0, 1, 2, 3]);
  store.apply([{ type: 'connect', source: root, target: 'three' }]); assert.equal(store.graph.nodes.at(-1).depth, 3);
  assert.deepEqual(fromCanvas(toCanvas(store.graph)).nodes.map(n => n.depth), [0, 1, 2, 3]);
  const legacy = newGraph(true); for (const n of legacy.nodes) delete n.depth;
  assert.deepEqual(validateGraph(legacy).nodes.map(n => n.depth), [0, 1, 1, 1, 2, 2, 2]);
});
test('invalid graph files are rejected, canvas roundtrip preserves types and text', () => {
  const graph = newGraph(true); graph.edges[0].type = 'dotted'; graph.edges[1].type = 'both';
  const restored = fromCanvas(toCanvas(graph), graph.title); assert.deepEqual(restored.edges, graph.edges); assert.deepEqual(restored.nodes.map(n => [n.id, n.text, n.x, n.y, n.color]), graph.nodes.map(n => [n.id, n.text, n.x, n.y, n.color]));
  assert.throws(() => validateGraph({ ...graph, nodes: [graph.nodes[0], graph.nodes[0]] }), /Duplicate/);
  assert.throws(() => fromCanvas({ nodes: [{ type: 'file' }], edges: [] }), /text nodes only/);
  assert.throws(() => validateGraph({ ...graph, nodes: [{ ...graph.nodes[0], x: Infinity }] }));
});
test('human field preconditions preserve simultaneous agent edits', () => {
  const store = new GraphStore(newGraph()); const id = store.graph.nodes[0].id;
  store.apply([{ type: 'updateNode', id, text: 'An agent thought', x: 120 }], 'Agent');
  assert.throws(() => store.apply([{ type: 'updateNode', id, text: 'My old draft', before: { text: 'Your big idea' } }]), /changed while you were editing/);
  assert.throws(() => store.apply([{ type: 'updateNode', id, x: 50, before: { x: 0 } }]), /changed while you were editing/);
  assert.equal(store.graph.nodes[0].text, 'An agent thought'); assert.equal(store.graph.nodes[0].x, 120);
});
test('JSON Canvas rounds coordinates and respects default and reversed arrows', () => {
  const graph = newGraph(true); graph.nodes[0].x = 1.2;
  const canvas = toCanvas(graph); assert.ok(Number.isInteger(canvas.nodes[0].x));
  canvas.edges = [{ id: 'default', fromNode: canvas.nodes[0].id, toNode: canvas.nodes[1].id }, { id: 'reverse', fromNode: canvas.nodes[1].id, toNode: canvas.nodes[2].id, fromEnd: 'arrow', toEnd: 'none' }];
  const imported = fromCanvas(canvas); assert.equal(imported.edges[0].type, 'arrow'); assert.equal(imported.edges[1].source, canvas.nodes[2].id);
});
