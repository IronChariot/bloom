import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore, newGraph, nodesOverlap, validateGraph, toCanvas, fromCanvas } from '../web/lib/graph.js';
import { labelExtent, labelLayout } from '../web/public/canvas/label-layout.js';

const chain = (store, prefix, from, count, extra = {}) => {
  const ops = []; let parent = from;
  for (let i = 0; i < count; i++) { ops.push({ type: 'addNode', id: prefix + i, text: `Step ${i} of ${prefix}`, parent, ...extra }); parent = prefix + i; }
  store.apply(ops); return parent;
};

test('automatic placement never stacks two blobs on the same spot', () => {
  const store = new GraphStore(newGraph()); const root = store.graph.nodes[0].id;
  // Two parallel chains and detours off the first, all without coordinates, as a flowchart needs.
  chain(store, 'm', root, 8); chain(store, 'x', root, 8);
  store.apply(Array.from({ length: 7 }, (_, i) => ({ type: 'addNode', id: 'd' + i, text: 'Detour ' + i, parent: 'm' + i })));
  const nodes = store.graph.nodes;
  assert.equal(nodes.length, 24);
  const collisions = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    if (nodes[i].x === nodes[j].x && nodes[i].y === nodes[j].y) collisions.push(`${nodes[i].id} sits exactly on ${nodes[j].id}`);
    else if (nodesOverlap(nodes[i], nodes[j])) collisions.push(`${nodes[i].id} overlaps ${nodes[j].id}`);
  }
  assert.deepEqual(collisions, []);
  // Explicit coordinates stay exactly where the caller put them.
  store.apply([{ type: 'addNode', id: 'fixed', text: 'Pinned', parent: root, x: 0, y: 0 }]);
  const fixed = store.graph.nodes.find(n => n.id === 'fixed');
  assert.deepEqual([fixed.x, fixed.y], [0, 0]);
});

test('edge styles survive later commits, and an undo by someone else is reported', () => {
  const store = new GraphStore(newGraph()); const root = store.graph.nodes[0].id;
  store.apply([{ type: 'addNode', id: 'a', text: 'A', parent: root }, { type: 'addNode', id: 'b', text: 'B', parent: 'a' }]);
  const implicit = store.graph.edges.find(e => e.source === 'a' && e.target === 'b');
  store.apply([{ type: 'connect', source: root, target: 'b', style: 'arrow', pattern: 'dotted' }]);
  const explicit = store.graph.edges.find(e => e.source === root && e.target === 'b');
  // Pattern and arrows together must both stick, on implicit and explicit edges alike.
  store.apply([{ type: 'styleEdges', ids: [implicit.id, explicit.id], pattern: 'dotted', arrows: 'arrow' }]);
  store.apply([{ type: 'addNode', id: 'later', text: 'Unrelated', parent: root }]);
  for (const id of [implicit.id, explicit.id]) {
    const edge = store.graph.edges.find(e => e.id === id);
    assert.equal(edge.pattern, 'dotted', 'pattern must survive an unrelated later commit');
    assert.equal(edge.type, 'arrow');
  }
  // Only an undo removes it again; that is the collaborator's change, not a lost write.
  store.undo(); store.undo();
  assert.equal(store.graph.edges.find(e => e.id === implicit.id).pattern, undefined);
  assert.equal(store.activity.at(-1).message, 'Undid a change');
});

test('edges carry labels through operations and file roundtrips', () => {
  const store = new GraphStore(newGraph()); const root = store.graph.nodes[0].id;
  store.apply([{ type: 'addNode', id: 'yes', text: 'Yes branch', parent: root }, { type: 'addNode', id: 'no', text: 'No branch', parent: root }]);
  const [first, second] = store.graph.edges;
  store.apply([{ type: 'updateEdge', id: first.id, label: '  Yes  ' }, { type: 'styleEdges', ids: [second.id], label: 'No', pattern: 'dotted' }]);
  assert.equal(store.graph.edges[0].label, 'Yes', 'labels are trimmed');
  assert.equal(store.graph.edges[1].label, 'No');
  assert.equal(store.graph.edges[1].pattern, 'dotted');
  const back = fromCanvas(toCanvas(store.graph), 'Roundtrip');
  assert.deepEqual(back.edges.map(e => e.label), ['Yes', 'No']);
  // Connecting with a label, then clearing it.
  store.apply([{ type: 'connect', source: 'yes', target: 'no', style: 'arrow', label: 'then' }]);
  assert.equal(store.graph.edges.at(-1).label, 'then');
  store.apply([{ type: 'updateEdge', id: store.graph.edges.at(-1).id, label: '' }]);
  assert.equal('label' in store.graph.edges.at(-1), false, 'an empty label removes it');
  assert.throws(() => store.apply([{ type: 'updateEdge', id: first.id, label: 'x'.repeat(81) }]));
});

test('explicit size frees a blob from its generation, within limits', () => {
  const store = new GraphStore(newGraph()); const root = store.graph.nodes[0].id;
  const deep = chain(store, 's', root, 10);
  const shrunk = labelExtent(store.graph.nodes.find(n => n.id === deep));
  store.apply([{ type: 'updateNode', id: deep, size: 2.5 }]);
  const node = store.graph.nodes.find(n => n.id === deep);
  assert.equal(node.size, 2.5);
  const grown = labelExtent(node);
  assert.ok(grown.rx > shrunk.rx * 2.4 && grown.ry > shrunk.ry * 2.4, 'size multiplies the generation scale');
  assert.ok(labelLayout(node, (t, f) => t.length * f * .5).font > labelLayout({ ...node, size: 1 }, (t, f) => t.length * f * .5).font);
  // A size travels through validation and a file roundtrip, and stays inside its range.
  assert.equal(validateGraph(fromCanvas(toCanvas(store.graph))).nodes.find(n => n.id === deep).size, 2.5);
  assert.throws(() => store.apply([{ type: 'addNode', id: 'huge', text: 'Too big', parent: root, size: 4 }]));
  assert.throws(() => store.apply([{ type: 'updateNode', id: deep, size: 0.1 }]));
  store.apply([{ type: 'addNode', id: 'sized', text: 'Big', parent: root, size: 2 }]);
  assert.equal(store.graph.nodes.find(n => n.id === 'sized').size, 2);
});

test('a bigger blob still gets a free spot', () => {
  const store = new GraphStore(newGraph()); const root = store.graph.nodes[0].id;
  store.apply(Array.from({ length: 6 }, (_, i) => ({ type: 'addNode', id: 'big' + i, text: 'A wide label for a big blob ' + i, parent: root, size: 2.5 })));
  const nodes = store.graph.nodes;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) assert.ok(!nodesOverlap(nodes[i], nodes[j]), `${nodes[i].id} overlaps ${nodes[j].id}`);
});
