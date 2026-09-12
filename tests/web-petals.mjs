import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { GraphStore, newGraph } from '../web/lib/graph.js';
const store=new GraphStore(newGraph()),root=store.graph.nodes[0].id;
store.apply([{type:'addNode',id:'a',text:'First branch',parent:root,x:-300,y:-160},{type:'addNode',id:'b',text:'Second branch',parent:root,x:300,y:-160}]);
const snap=()=>({...store.snapshot(),boardId:'petal-test',dirty:false,recent:[],members:[],role:'owner',user:{id:'email:tester@example.com',name:'tester@example.com'},agentEnabled:false});
const server=http.createServer(async(req,res)=>{
  const send=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
    const chunks=[];for await(const c of req)chunks.push(c);const input=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
    if(url.pathname==='/api/me')return send({userId:'email:tester@example.com',displayName:'tester@example.com'});
    if(url.pathname==='/api/boards')return send({boards:[{id:'petal-test',title:'Petal test'}]});
    if(url.pathname.endsWith('/sync'))return send({revision:store.revision,members:[],agentEnabled:false,...(input.revision!==store.revision?{state:snap()}:{})});
    if(url.pathname.endsWith('/edit')){try{if(input.action==='undo')store.undo();else if(input.action==='redo')store.redo();else store.apply(input.operations,'Test user',input.expectedRevision,'tester@example.com');return send(snap());}catch(e){return send({error:e.message},409);}}
    if(url.pathname==='/api/boards/petal-test')return send(snap());return send({});
  }
  const file=path.resolve('web/public',url.pathname==='/'?'index.html':'.'+url.pathname);
  if(!file.startsWith(path.resolve('web/public')+path.sep))return res.writeHead(404).end();
  try{const body=await fs.readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?board=petal-test`);
  const frame=page.frameLocator('iframe'),node=id=>frame.locator(`[data-node="${id}"]`);
  await node(root).waitFor();
  const wait=async f=>{for(let i=0;i<200;i++){if(await f())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out waiting for expected state');};
  let lastSavedRevision=store.revision;
  const saved=async()=>{await wait(async()=>store.revision>lastSavedRevision && await frame.locator('body').evaluate(async()=> (await window.bloom.getState()).revision)===store.revision && await frame.locator('#save-status').innerText()==='All changes saved');lastSavedRevision=store.revision;await frame.locator('body').evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
  async function clickNode(id,options={}){let b;await wait(async()=>!!(b=await node(id).locator('.bubble-shape').boundingBox()));await page.mouse.click(b.x+b.width/2,b.y+12,options);}
  async function clickEdge(id){const loc=frame.locator(`[data-edge="${id}"] .edge`);let point;await wait(async()=>{point=await loc.evaluate(el=>{if(!el.getAttribute('d'))return null;const p=el.getPointAtLength(el.getTotalLength()/2),q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return{x:q.x,y:q.y};});return !!point;});const b=await page.locator('iframe').boundingBox();await page.mouse.click(point.x+b.x,point.y+b.y);}
  await clickNode('a');await page.keyboard.down('Control');await clickNode('b');await page.keyboard.up('Control');
  assert.equal(await frame.locator('.bubble.selected').count(),2);
  const previous=store.revision;await frame.getByRole('button',{name:'Set colour #ed7d9c',exact:true}).click();await saved();
  assert.equal(store.revision,previous+1);assert.ok(store.graph.nodes.filter(n=>['a','b'].includes(n.id)).every(n=>n.color==='#ed7d9c'));
  await frame.getByRole('button',{name:'Undo',exact:true}).click();await saved();assert.ok(store.graph.nodes.filter(n=>['a','b'].includes(n.id)).every(n=>n.color!=='#ed7d9c'));
  const ids=store.graph.edges.map(e=>e.id);await clickEdge(ids[0]);await page.keyboard.down('Control');await clickEdge(ids[1]);await page.keyboard.up('Control');
  assert.equal(await frame.locator('.edge.selected').count(),2);assert.equal(await frame.locator('.bubble.selected').count(),0);
  await frame.getByRole('button',{name:'Dotted line',exact:true}).click();await saved();await frame.getByRole('button',{name:'Two-way arrow',exact:true}).click();await saved();
  for(const name of ['Dotted line','Two-way arrow'])assert.equal(await frame.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
  assert.ok(store.graph.edges.every(e=>e.pattern==='dotted'&&e.type==='both'));
  await frame.getByRole('button',{name:'Undo',exact:true}).click();await saved();assert.ok(store.graph.edges.every(e=>e.pattern==='dotted'&&e.type==='arrow'));
  console.log('PASS: Ctrl multi-selection by type, independent style highlights and single-step bulk undo');
  async function right(){await clickNode(root,{button:'right'});await frame.getByRole('dialog',{name:'Add petal',exact:true}).waitFor();}
  await right();await frame.getByRole('button',{name:'Blank petal',exact:true}).click();
  assert.equal(await frame.locator('.petal-color-choice').count(),24);
  await page.screenshot({path:'artifacts/bloom-petal-colours.png',animations:'disabled'});
  await frame.locator('.petal-color-choice').first().click();await saved();await node(root).locator('[data-petal]').waitFor();
  assert.equal(store.graph.nodes[0].petals[0].slot,0);
  await right();await frame.getByRole('button',{name:'Emoticon petal',exact:true}).click();
  assert.equal(await frame.locator('.petal-choice[aria-label^="Emoticon "]').count(),32);
  await frame.getByRole('button',{name:'Emoticon 😀',exact:true}).click();await saved();
  assert.equal(store.graph.nodes[0].petals[1].color,'#ffffff');
  await right();await frame.getByRole('button',{name:'Comment petal',exact:true}).click();
  const input=frame.getByRole('textbox',{name:'Enter your comment',exact:true});
  assert.equal(await frame.getByRole('button',{name:'Confirm comment',exact:true}).isDisabled(),true);
  await input.fill('First line');await page.keyboard.press('Shift+Enter');await page.keyboard.type('Second line');await page.keyboard.press('Enter');await saved();
  const comment=store.graph.nodes[0].petals[2];assert.equal(comment.comment,'First line\nSecond line');assert.equal(comment.author,'tester@example.com');
  const petal=id=>node(root).locator(`[data-petal="${id}"]`);
  await petal(comment.id).hover();await frame.getByRole('tooltip').waitFor();
  assert.match(await frame.getByRole('tooltip').innerText(),/tester@example.com/);assert.match(await frame.getByRole('tooltip').innerText(),/Second line/);
  await petal(comment.id).click();await frame.getByRole('button',{name:'Edit comment',exact:true}).click();await input.fill('Updated note');await frame.getByRole('button',{name:'Confirm comment',exact:true}).click();await saved();
  assert.equal(store.graph.nodes[0].petals[2].comment,'Updated note');
  await petal(comment.id).click();assert.equal(await frame.getByRole('button',{name:'Choose emoticon',exact:true}).count(),0);await page.keyboard.press('Escape');
  const plain=store.graph.nodes[0].petals[0],emoji=store.graph.nodes[0].petals[1];
  await petal(emoji.id).click();assert.equal(await frame.getByRole('button',{name:'Add comment',exact:true}).count(),0);await frame.getByRole('button',{name:'Change petal colour',exact:true}).click();await frame.locator('.petal-color-choice').last().click();await saved();assert.notEqual(store.graph.nodes[0].petals[1].color,'#ffffff');
  // Drag the first petal onto the next one; observe the neighbour moving before release.
  const a=await petal(plain.id).boundingBox(),b=await petal(emoji.id).boundingBox();
  const oldTransform=await petal(emoji.id).getAttribute('transform');
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});
  await wait(async()=>await petal(emoji.id).getAttribute('transform')!==oldTransform);await page.screenshot({path:'artifacts/bloom-petals-drag.png'});await page.mouse.up();await saved();
  assert.equal(store.graph.nodes[0].petals.find(p=>p.id===plain.id).slot,1);assert.equal(new Set(store.graph.nodes[0].petals.map(p=>p.slot)).size,3);
  await petal(plain.id).click();await frame.getByRole('button',{name:'Delete petal',exact:true}).click();await saved();assert.equal(store.graph.nodes[0].petals.length,2);
  await frame.getByRole('button',{name:'Undo',exact:true}).click();await saved();assert.equal(store.graph.nodes[0].petals.length,3);
  for(let i=0;i<5;i++)store.apply([{type:'addPetal',nodeId:root,kind:'color',color:'#8675ef'}]);
  await wait(async()=>await node(root).locator('[data-petal]').count()===8);
  await clickNode(root,{button:'right'});assert.equal(await frame.getByRole('dialog',{name:'Add petal',exact:true}).count(),0);assert.match(await frame.locator('#toast').innerText(),/eight petals/);
  await wait(async()=>await node(root).locator('[data-petal]').evaluateAll(els=>els.every(el=>Number(el.getAttribute('transform')?.match(/scale\(([^)]+)\)/)?.[1]||0)>.999)));
  await page.screenshot({path:'artifacts/bloom-petals.png'});
  await page.reload();await node(root).waitFor();assert.equal(await node(root).locator('[data-petal]').count(),8);
  assert.deepEqual(errors,[]);console.log('PASS: radial colour/emoticon menus, comments and attribution, conversion rules, animated occupied-slot drag, delete/undo, eight-petal limit and reload persistence');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
