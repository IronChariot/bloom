import test from 'node:test';
import { registerHooks } from 'node:module';
import { withIdentity } from '../web/lib/identity.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { profileIdentity, saveProfile, attributionNames, boardActivity } from '../web/lib/profiles.js';
import { displayName } from '../web/public/canvas/attribution.js';

test('account names persist, resolve historical attribution and cannot rename another account', async () => {
  const sql = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync('web/drizzle').filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(`web/drizzle/${file}`, 'utf8'));
    const db = {
      prepare(query) { return { bind(...args) { const statement = sql.prepare(query); return {
        first: async () => statement.get(...args), all: async () => ({results:statement.all(...args)}), run: async () => statement.run(...args)
      }; } }; },
      async batch(statements) { sql.exec('BEGIN'); try { const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;} catch(error){sql.exec('ROLLBACK');throw error;} }
    };
    const user = {userId:'email:sam@example.com',email:'sam@example.com',displayName:'sam@example.com'};
    for (const id of ['one','two']) {
      sql.prepare('INSERT INTO boards (id, owner, graph, updated) VALUES (?, ?, ?, 0)').run(id,user.userId,'{}');
      sql.prepare('INSERT INTO members VALUES (?, ?, ?, ?, 0)').run(id,user.userId,user.displayName,'owner');
    }
    sql.prepare('INSERT INTO members VALUES (?, ?, ?, ?, 0)').run('one','email:other@example.com','Other','editor');
    for (const [revision,actor] of [[0,user.email],[1,user.userId],[2,'AI collaborator']]) sql.prepare('INSERT INTO changes VALUES (?, ?, ?, ?, 0, ?)').run('one',revision,'{}',actor,'Edited');
    assert.equal((await profileIdentity(db,user)).hasDisplayName,false);
    await saveProfile(db,user,{displayName:'  Sam <&>  ',userId:'email:other@example.com'});
    assert.equal((await profileIdentity(db,user)).displayName,'Sam <&>');
    assert.equal(sql.prepare('SELECT name FROM members WHERE user_id = ?').get('email:other@example.com').name,'Other');
    assert.ok(sql.prepare('SELECT name FROM members WHERE user_id = ?').all(user.userId).every(r=>r.name==='Sam <&>'));
    assert.deepEqual((await boardActivity(db,'one')).map(a=>a.actor),['Sam <&>','Sam <&>','AI collaborator']);
    const graph={nodes:[{petals:[{author:user.email,updatedBy:user.email}]}]};
    sql.prepare('DELETE FROM members WHERE user_id = ?').run(user.userId);
    await saveProfile(db,user,{displayName:'Samuel'});
    const names=await attributionNames(db,graph);
    assert.equal(displayName({attribution:names},user.email),'Samuel','Former members still have named comments');
    assert.equal(displayName({members:[{id:user.userId,name:'Newest name'}],attribution:names},user.email),'Newest name');
    assert.equal(displayName({},'someone@example.com'),'someone@example.com');
    assert.equal(sql.prepare('SELECT graph FROM changes LIMIT 1').get().graph,'{}','Profile edits do not rewrite board history');
    for(const displayName of ['', ' ', 'x'.repeat(81), 'Line\nBreak', null]) await assert.rejects(saveProfile(db,user,{displayName}), {status:400});
    assert.equal((await profileIdentity(db,user)).displayName,'Samuel');
    globalThis.__bloomProfileTestEnv = { DB: db };
    const hooks = registerHooks({resolve(specifier, context, next) {
      return specifier === 'cloudflare:workers' ? {url:'data:text/javascript,export const env = globalThis.__bloomProfileTestEnv;',shortCircuit:true} : next(specifier,context);
    }});
    try {
      const {handleApi} = await import('../web/lib/boards.js');
      const request = (origin='https://bloom.test') => new Request('https://bloom.test/api/me', {method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({displayName:'Account name',userId:'email:other@example.com'})});
      await assert.rejects(withIdentity(null,()=>handleApi(request(),['me'])), {status:401});
      await assert.rejects(withIdentity(user,()=>handleApi(request('https://elsewhere.test'),['me'])), {status:403});
      const result=await withIdentity(user,()=>handleApi(request(),['me']));
      assert.equal(result.userId,user.userId); assert.equal(result.displayName,'Account name');
      assert.equal(sql.prepare('SELECT name FROM members WHERE user_id = ?').get('email:other@example.com').name,'Other');
    } finally { hooks.deregister(); delete globalThis.__bloomProfileTestEnv; }

  } finally { sql.close(); }
});
