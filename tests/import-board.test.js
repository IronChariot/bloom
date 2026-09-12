import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { withIdentity } from '../web/lib/identity.js';
import { newGraph, validateGraph, toCanvas } from '../web/lib/graph.js';

test('import replaces a shared board atomically, preserves access and supports undo/redo', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync('web/drizzle').filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(`web/drizzle/${file}`, 'utf8'));
  const db = {
    prepare(query) { return { bind(...args) { const stmt = sql.prepare(query); return {
      first: async () => stmt.get(...args), all: async () => ({results:stmt.all(...args)}), run: async () => ({meta:stmt.run(...args)})
    }; } }; },
    async batch(statements) { sql.exec('BEGIN');try { const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;} }
  };
  globalThis.__bloomImportTestEnv = {DB:db};
  const hooks = registerHooks({resolve(specifier, context, next) {
    return specifier === 'cloudflare:workers' ? {url:'data:text/javascript,export const env = globalThis.__bloomImportTestEnv;',shortCircuit:true} : next(specifier,context);
  }});
  try {
    const {handleApi} = await import('../web/lib/boards.js');
    const user = {userId:'email:importer@example.com',email:'importer@example.com',displayName:'Importer'};
    const api = (segments, body, who=user) => withIdentity(who,()=>handleApi(new Request(`https://bloom.test/api/${segments.join('/')}`, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json',Origin:'https://bloom.test'},body:JSON.stringify(body)}),segments));
    const {id} = await api(['boards'],{graph:newGraph(true)});
    sql.prepare('UPDATE boards SET invite_hash = ?, agent_hash = ? WHERE id = ?').run('invite-kept','agent-kept',id);
    sql.prepare('INSERT INTO members VALUES (?, ?, ?, ?, 0)').run(id,'editor','Editor','editor');
    const original = await api(['boards',id]);
    const imported = newGraph(); imported.title = 'Restored download';
    imported.nodes[0].petals = [{id:'note',slot:3,kind:'comment',color:'#ed7d9c',comment:'Preserve this note',author:'prior@example.com',createdAt:100}];
    for(let i=0;i<205;i++) {
      imported.nodes.push({id:`import-${i}`,text:`Idea ${i}`,x:i*5,y:i,color:'#8675ef',depth:2});
      imported.edges.push({id:`edge-${i}`,source:imported.nodes[0].id,target:`import-${i}`,type:'both',pattern:'dotted'});
    }
    const edit = (body, who) => api(['boards',id,'edit'],body,who);
    const result = await edit({action:'import',graph:imported,expectedRevision:0});
    assert.equal(result.boardId,id);assert.equal(result.revision,1);assert.deepEqual(result.graph,validateGraph(imported));
    assert.deepEqual({...sql.prepare('SELECT owner, invite_hash, agent_hash FROM boards WHERE id = ?').get(id)}, {owner:user.userId,invite_hash:'invite-kept',agent_hash:'agent-kept'});
    assert.equal(sql.prepare('SELECT count(*) AS n FROM members WHERE board_id = ?').get(id).n,2);
    const undone = await edit({action:'undo',expectedRevision:1});assert.deepEqual(undone.graph,original.graph);
    const redone = await edit({action:'redo',expectedRevision:2});assert.deepEqual(redone.graph,result.graph);
    const bad = structuredClone(imported);bad.nodes.push(bad.nodes[0]);
    await assert.rejects(edit({action:'import',graph:bad,expectedRevision:3}),{status:400});
    await assert.rejects(edit({action:'import',graph:{},expectedRevision:3}),{status:400});
    const huge=structuredClone(imported);huge.nodes=Array.from({length:600},(_,i)=>({...imported.nodes[0],id:`huge-${i}`,text:'x'.repeat(2000)}));huge.edges=[];
    await assert.rejects(edit({action:'import',graph:huge,expectedRevision:3}),{status:400});
    assert.equal((await api(['boards',id])).revision,3);
    await edit({operations:[{type:'updateNode',id:imported.nodes[0].id,x:50}],expectedRevision:3});
    await assert.rejects(edit({action:'import',graph:original.graph,expectedRevision:3,expectedContentRevision:3,expectedLayoutRevision:4}),{status:409});
    const restored = await edit({action:'import',graph:toCanvas(original.graph),title:'Canvas file',expectedRevision:4},{userId:'editor',displayName:'Editor'});
    assert.equal(restored.graph.title,'Canvas file');assert.equal(restored.revision,5);
    await assert.rejects(edit({action:'import',graph:imported,expectedRevision:5},{userId:'stranger',displayName:'Stranger'}),{status:403});
  } finally { hooks.deregister();delete globalThis.__bloomImportTestEnv;sql.close(); }
});
