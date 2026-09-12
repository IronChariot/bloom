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
globalThis.__bloomImportUIEnv={DB:db};
const hooks=registerHooks({resolve(specifier,context,next){return specifier==='cloudflare:workers'?{url:'data:text/javascript,export const env = globalThis.__bloomImportUIEnv;',shortCircuit:true}:next(specifier,context);}});
const {handleApi}=await import('../web/lib/boards.js');
const user={userId:'email:import-ui@example.com',email:'import-ui@example.com',displayName:'Import test'};
const call=(segments,body)=>withIdentity(user,()=>handleApi(new Request(`http://localhost/api/${segments.join('/')}`,body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),segments));
const original=newGraph(true);original.title='Downloaded board';original.nodes[0].petals=[{id:'note',slot:0,kind:'comment',comment:'A saved comment',author:user.email,createdAt:1,color:'#ffffff'}];
const {id}=await call(['boards'],{graph:original});
const row=()=>sql.prepare('SELECT graph,revision FROM boards WHERE id = ?').get(id);
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(url.pathname.startsWith('/api/')) {
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    try {
      const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:Buffer.concat(chunks)})});
      const result=await withIdentity(user,()=>handleApi(request,url.pathname.slice(5).split('/')));
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
  const page=await browser.newPage({viewport:{width:1400,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?board=${id}`);
  const frame=page.frameLocator('iframe');await frame.locator('#board-title').waitFor();
  const wait=async f=>{for(let i=0;i<200;i++){if(await f())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out waiting for import state');};
  const synced=()=>wait(async()=>await frame.locator('body').evaluate(async()=>(await window.bloom.getState()).revision)===row().revision);
  const [download]=await Promise.all([page.waitForEvent('download'),frame.getByRole('button',{name:'Download board',exact:true}).click()]);
  await fs.mkdir('artifacts',{recursive:true});const file=path.resolve('artifacts/bloom-import-download.bloom');await download.saveAs(file);
  const downloaded=JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(downloaded,JSON.parse(row().graph));
  await call(['boards',id,'edit'],{operations:[{type:'rename',title:'Before importing'}],expectedRevision:row().revision});await synced();
  await frame.locator(`[data-node="${original.nodes[0].id}"]`).focus();await page.keyboard.press('Enter');
  await frame.getByRole('textbox',{name:'Edit idea',exact:true}).fill('Preserve this unfinished edit in Undo');
  const choose=async()=>{const [chooser]=await Promise.all([page.waitForEvent('filechooser'),frame.getByRole('button',{name:'Upload board',exact:true}).click()]);return chooser;};
  const chooser=await choose();const before=JSON.parse(row().graph),beforeRevision=row().revision;
  assert.equal(before.nodes[0].text,'Preserve this unfinished edit in Undo');
  await chooser.setFiles(file);await wait(()=>row().revision===beforeRevision+1);await synced();
  assert.deepEqual(JSON.parse(row().graph),downloaded);assert.equal(new URL(page.url()).searchParams.get('board'),id);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boards').get().n,1);
  await frame.getByRole('button',{name:'Undo',exact:true}).click();await wait(()=>row().revision===beforeRevision+2);await synced();
  assert.deepEqual(JSON.parse(row().graph),before);
  await frame.getByRole('button',{name:'Redo',exact:true}).click();await wait(()=>row().revision===beforeRevision+3);await synced();
  assert.deepEqual(JSON.parse(row().graph),downloaded);
  await page.screenshot({path:'artifacts/bloom-imported-board.png'});
  const stableRevision=row().revision;
  await (await choose()).setFiles({name:'broken.bloom',mimeType:'application/json',buffer:Buffer.from('{broken')});
  await wait(async()=>/not valid JSON/.test(await frame.locator('#toast').innerText()));assert.equal(row().revision,stableRevision);
  const invalid=structuredClone(downloaded);invalid.nodes.push(invalid.nodes[0]);
  await (await choose()).setFiles({name:'invalid.bloom',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
  await wait(async()=>/not a valid Bloom board/.test(await frame.locator('#toast').innerText()));assert.equal(row().revision,stableRevision);
  const stale=await choose();await call(['boards',id,'edit'],{operations:[{type:'rename',title:'A collaborator edited this'}],expectedRevision:row().revision});
  await stale.setFiles(file);await wait(async()=>/board changed/i.test(await frame.locator('#toast').innerText()));
  assert.equal(JSON.parse(row().graph).title,'A collaborator edited this');
  assert.equal(row().revision,stableRevision+1);assert.deepEqual(errors,[]);
  console.log('PASS: actual download/upload roundtrip, pending edit flush, same-board replacement, single undo/redo, invalid-file rollback and collaborator conflict');
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));hooks.deregister();delete globalThis.__bloomImportUIEnv;sql.close();}
