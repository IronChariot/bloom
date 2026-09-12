import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore, newGraph, toCanvas, fromCanvas } from '../web/lib/graph.js';
import { arrangePetals } from '../web/public/canvas/petal-model.js';
import { readView, editDelta } from '../web/lib/agent-views.js';

test('new branches point outward; line patterns and arrows compose and bulk undo together', () => {
  const store=new GraphStore(newGraph()),root=store.graph.nodes[0].id;
  store.apply([{type:'addNode',id:'a',parent:root},{type:'addNode',id:'b',parent:root}]);
  assert.ok(store.graph.edges.every(e=>e.type==='arrow'&&!e.pattern));
  const ids=store.graph.edges.map(e=>e.id);
  store.apply([{type:'styleEdges',ids,pattern:'dotted'}]);
  assert.ok(store.graph.edges.every(e=>e.pattern==='dotted'&&e.type==='arrow'));
  store.apply([{type:'styleEdges',ids,arrows:'both'}]);
  assert.ok(store.graph.edges.every(e=>e.pattern==='dotted'&&e.type==='both'));
  store.undo(); assert.ok(store.graph.edges.every(e=>e.pattern==='dotted'&&e.type==='arrow'));
  store.apply([{type:'colorNodes',ids:[root,'a','b'],color:'#abcdef'}]);
  assert.ok(store.graph.nodes.every(n=>n.color==='#abcdef')); store.undo(); assert.ok(store.graph.nodes.every(n=>n.color!=='#abcdef'));
  assert.deepEqual(fromCanvas(toCanvas(store.graph)).edges,store.graph.edges);
});

test('petals enforce capacity, unique slots, authored comments and allowed conversions atomically',()=>{
  const store=new GraphStore(newGraph()),nodeId=store.graph.nodes[0].id;
  const run=ops=>store.apply(ops,'Display name',store.revision,'real@example.com');
  run([{type:'addPetal',nodeId,id:'note',kind:'comment',comment:'First\nsecond',author:'forged@example.com',createdAt:1}]);
  const note=store.graph.nodes[0].petals[0]; assert.equal(note.author,'real@example.com'); assert.notEqual(note.createdAt,1); assert.equal(note.slot,0);
  run([{type:'updatePetal',nodeId,id:'note',comment:'Edited',color:'#123456'}]);
  assert.throws(()=>run([{type:'updatePetal',nodeId,id:'note',beforeComment:'First\nsecond',comment:'Stale edit'}]),/changed/);
  assert.equal(store.graph.nodes[0].petals[0].createdAt,note.createdAt); assert.equal(store.graph.nodes[0].petals[0].updatedBy,'real@example.com');
  assert.throws(()=>run([{type:'updatePetal',nodeId,id:'note',kind:'emoji',emoji:'😀'}]));
  run([{type:'addPetal',nodeId,id:'plain',kind:'color',color:'#987654'},{type:'updatePetal',nodeId,id:'plain',kind:'emoji',emoji:'😀'}]);
  assert.throws(()=>run([{type:'updatePetal',nodeId,id:'plain',kind:'comment',comment:'No'}]));
  assert.throws(()=>run([{type:'addPetal',nodeId,kind:'comment',comment:'  '} ]));
  const before=structuredClone(store.graph);
  assert.throws(()=>run(Array.from({length:7},(_,i)=>({type:'addPetal',nodeId,id:`p${i}`,kind:'color'}))));
  assert.deepEqual(store.graph,before);
  run(Array.from({length:6},(_,i)=>({type:'addPetal',nodeId,id:`p${i}`,kind:'color'})));
  assert.deepEqual(store.graph.nodes[0].petals.map(p=>p.slot),[0,1,2,3,4,5,6,7]);
  run([{type:'movePetal',nodeId,id:'note',slot:3}]);
  assert.equal(new Set(store.graph.nodes[0].petals.map(p=>p.slot)).size,8);
  assert.equal(store.graph.nodes[0].petals.find(p=>p.id==='note').slot,3);
  const restored=fromCanvas(toCanvas(store.graph));assert.deepEqual(restored.nodes[0].petals,store.graph.nodes[0].petals);
  const compact=readView({id:'board',revision:store.revision,graph:JSON.stringify(store.graph)});assert.equal(compact.graph.nodes[0].petals.length,8);
  const old=structuredClone(store.graph);run([{type:'deletePetal',nodeId,id:'note'}]);
  assert.equal(editDelta('board',store.revision-1,old,store.graph).updated.nodes[0].petals.length,7);
  store.undo();assert.equal(store.graph.nodes[0].petals.length,8);
});

test('petal insertion into occupied slots moves neighbours into gaps',()=>{
  const petals=[{id:'a',slot:0},{id:'b',slot:1},{id:'c',slot:2}];
  assert.deepEqual(arrangePetals(petals,'a',1).map(p=>p.slot),[1,2,3]);
  assert.deepEqual(petals.map(p=>p.slot),[0,1,2]);
});
