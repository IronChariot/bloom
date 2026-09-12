import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { revisions, revisionChanges, checkRevision } from '../web/lib/revisions.js';
import { newGraph, GraphStore, toCanvas, fromCanvas } from '../web/lib/graph.js';
import { colorShades } from '../web/public/canvas/color-shades.js';

test('content edits tolerate moves, layout edits tolerate text, and mixed edits check both', () => {
  const board = { revision: 8, content_revision: 5, layout_revision: 8 };
  assert.doesNotThrow(() => checkRevision(board, { expectedContentRevision: 5, operations: [{ type: 'updateNode', id: 'n', text: 'new' }] }));
  assert.throws(() => checkRevision(board, { expectedContentRevision: 4, operations: [{ type: 'rename', title: 'new' }] }), /content/);
  assert.throws(() => checkRevision(board, { expectedContentRevision: 5, operations: [{ type: 'updateNode', id: 'n', x: 3 }] }), /layout/);
  assert.throws(() => checkRevision(board, { expectedRevision: 5, operations: [{ type: 'rename', title: 'new' }] }), /changed/);
  assert.doesNotThrow(() => checkRevision({ revision: 9, content_revision: 9, layout_revision: 8 }, { expectedLayoutRevision: 8, operations: [{ type: 'updateNode', id: 'n', x: 3 }] }));
  assert.throws(() => checkRevision(board, { expectedLayoutRevision: 8, operations: [{ type: 'updateNode', id: 'n', x: 3, text: 'new' }] }), /content/);
  assert.throws(() => checkRevision(board, { operations: [{ type: 'rename', title: 'new' }] }));
  assert.deepEqual(revisions({ ...board, revision: 10 }), { revision: 10, contentRevision: 10, layoutRevision: 10 });
});

test('graph changes classify layout, content, structure and reverse edge roundtrips', () => {
  const original = newGraph(true), moved = structuredClone(original); moved.nodes[0].x++;
  assert.deepEqual(revisionChanges(original, moved), { content: false, layout: true });
  const text = structuredClone(original); text.nodes[0].text = 'new';
  assert.deepEqual(revisionChanges(original, text), { content: true, layout: false });
  const store = new GraphStore(original), edge = store.graph.edges[0];
  store.apply([{ type: 'connect', source: edge.source, target: edge.target, style: 'reverse' }]);
  assert.equal(store.graph.edges[0].id, edge.id);
  assert.deepEqual(revisionChanges(original, store.graph), { content: true, layout: false });
  assert.deepEqual(fromCanvas(toCanvas(store.graph)).edges, store.graph.edges);
});

test('revision migration preserves existing board graph and establishes conservative baselines', () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE boards (id TEXT, graph TEXT, revision INTEGER); INSERT INTO boards VALUES (\'old\', \'unchanged\', 42)');
  sql.exec(readFileSync('web/drizzle/0003_curious_captain_universe.sql', 'utf8'));
  const row = sql.prepare('SELECT * FROM boards').get();
  assert.equal(row.graph, 'unchanged'); assert.equal(row.content_revision, 42); assert.equal(row.layout_revision, 42); sql.close();
});

test('shade choices are distinct valid colours, including the white palette', () => {
  for (const color of ['#ffffff', '#8675ef', '#f3af47']) {
    const shades = colorShades(color);
    assert.equal(new Set(shades).size, 6); assert.ok(shades.every(c => /^#[0-9a-f]{6}$/.test(c)));
  }
});
