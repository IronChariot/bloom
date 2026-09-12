import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { chromium } from 'playwright';
import { withIdentity } from '../web/lib/identity.js';
import { newGraph } from '../web/lib/graph.js';

const sql = new DatabaseSync(':memory:');
for (const file of (await fs.readdir('web/drizzle')).filter(f=>f.endsWith('.sql')).sort()) sql.exec(await fs.readFile(`web/drizzle/${file}`,'utf8'));
const db = {
  prepare(query) {return {bind(...args) {const stmt=sql.prepare(query);return {first:async()=>stmt.get(...args),all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:stmt.run(...args)})};}};},
  async batch(statements) {sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}
};
globalThis.__bloomPresenceUIEnv={DB:db};
const hooks=registerHooks({resolve(specifier,context,next){return specifier==='cloudflare:workers'?{url:'data:text/javascript,export const env = globalThis.__bloomPresenceUIEnv;',shortCircuit:true}:next(specifier,context);}});
const {handleApi}=await import('../web/lib/boards.js');
const user={userId:'email:import-ui@example.com',email:'import-ui@example.com',displayName:'Import test'};
const call=(segments,body)=>withIdentity(user,()=>handleApi(new Request(`http://localhost/api/${segments.join('/')}`,body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),segments));
const original=newGraph(true);original.title='Downloaded board';original.nodes[0].petals=[{id:'note',slot:0,kind:'comment',comment:'A saved comment',author:user.email,createdAt:1,color:'#ffffff'}];
const {id}=await call(['boards'],{graph:original});
sql.prepare('INSERT INTO members VALUES (?, ?, ?, ?, 0)').run(id,'bob','Bob','editor');
const row=()=>sql.prepare('SELECT graph,revision FROM boards WHERE id = ?').get(id);
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(url.pathname.startsWith('/api/')) {
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    try {
      const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:Buffer.concat(chunks)})});
      const who = req.headers['x-test-user'] === 'bob' ? {userId:'bob',displayName:'Bob'} : user;
      const result=await withIdentity(who,()=>handleApi(request,url.pathname.slice(5).split('/')));
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
    }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
    return;
  }
  const file=path.resolve('web/public',url.pathname==='/'?'index.html':'.'+url.pathname);
  if(!file.startsWith(path.resolve('web/public')+path.sep))return res.writeHead(404).end();
  try{const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});res.end(data);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const a = await browser.newContext({viewport:{width:1400,height:950}}), b = await browser.newContext({viewport:{width:1400,height:950},extraHTTPHeaders:{'x-test-user':'bob'}});
  const pageA = await a.newPage(), pageB = await b.newPage(), errors=[];
  for (const page of [pageA,pageB]) page.on('pageerror', e=>errors.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}/?board=${id}`;
  await Promise.all([pageA.goto(url),pageB.goto(url)]);
  const fa=pageA.frameLocator('iframe'),fb=pageB.frameLocator('iframe'),node=original.nodes[0].id,other=original.nodes[1].id,edge=original.edges[0].id;
  await Promise.all([fa.locator(`[data-node="${node}"]`).waitFor(),fb.locator(`[data-node="${node}"]`).waitFor()]);
  const wait=async f=>{for(let i=0;i<400;i++){if(await f())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out waiting for collaboration state');};
  const editA=fa.getByRole('textbox',{name:'Edit idea',exact:true}),editB=fb.getByRole('textbox',{name:'Edit idea',exact:true});
  await fa.locator(`[data-node="${node}"]`).focus();await pageA.keyboard.press('Enter');await editA.fill('Alice is composing a thought');
  await wait(async()=>await fb.locator('.remote-selection-label').count()>0);
  assert.match(await fb.locator('.remote-selection-label').first().innerText(),/Import test · editing/);
  assert.match(await fb.locator(`[data-node="${node}"]`).getAttribute('class'),/remote-selected/);
  await fb.locator(`[data-node="${node}"]`).focus();await pageB.keyboard.press('Enter');
  await wait(async()=>/is editing/.test(await fb.locator('#toast').innerText()));assert.equal(await editB.count(),0);
  assert.equal(row().revision,0);
  // Selecting a link remains advisory and does not lock the graph.
  await fb.locator(`[data-edge="${edge}"] .edge-hit`).dispatchEvent('pointerdown',{button:0,pointerId:1});
  await wait(async()=>/remote-selected/.test(await fa.locator(`[data-edge="${edge}"]`).getAttribute('class')));
  await fs.mkdir('artifacts',{recursive:true});await pageB.screenshot({path:'artifacts/bloom-collaboration.png'});
  const boxes=await fb.locator('body').evaluate(()=>[...document.querySelectorAll('.remote-selection-label')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  const nodeBoxes=await fb.locator('body').evaluate(()=>[...document.querySelectorAll('.bubble-shape')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(const label of boxes)for(const box of nodeBoxes)assert.ok(label.x>=box.x+box.w||label.x+label.w<=box.x||label.y>=box.y+box.h||label.y+label.h<=box.y,'Name label must not cover a blob');
  await editA.press('Enter');await wait(()=>row().revision===1);await wait(()=>sql.prepare('SELECT count(*) AS n FROM edit_locks').get().n===0);
  await fb.locator(`[data-node="${node}"]`).focus();await pageB.keyboard.press('Enter');await editB.waitFor();
  assert.equal(await editB.inputValue(),'Alice is composing a thought');await editB.fill('Bob’s unsaved draft');
  // Expired leases refuse a stale save, keep the full draft, and allow a deliberate retry.
  sql.prepare('UPDATE edit_locks SET expires = 1').run();
  await editB.press('Enter');await fb.getByRole('region',{name:'Unsaved idea draft'}).waitFor();
  assert.equal(await fb.getByRole('textbox',{name:'Unsaved draft'}).inputValue(),'Bob’s unsaved draft');assert.equal(row().revision,1);
  await fb.getByRole('button',{name:'Retry editing',exact:true}).click();await editB.waitFor();assert.equal(await editB.inputValue(),'Bob’s unsaved draft');
  await editB.press('Enter');await wait(()=>row().revision===2);
  assert.equal(JSON.parse(row().graph).nodes.find(n=>n.id===node).text,'Bob’s unsaved draft');
  // Closing a tab releases its lock and leaves no ghost selection.
  await fa.locator(`[data-node="${other}"]`).focus();await pageA.keyboard.press('Enter');await editA.waitFor();
  await pageA.close();await wait(()=>sql.prepare('SELECT count(*) AS n FROM edit_locks').get().n===0);
  await wait(async()=>await fb.locator(`[data-node="${other}"]`).getAttribute('class').then(s=>!s.includes('remote-selected')));
  assert.deepEqual(errors,[]);
  console.log('PASS: two-browser named selections, exclusive editor, release on save/close, expired lease draft recovery, and labels outside blobs');
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));hooks.deregister();delete globalThis.__bloomPresenceUIEnv;sql.close();}
