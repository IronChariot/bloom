import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { chromium } from 'playwright';
import { withIdentity } from '../web/lib/identity.js';
import { newGraph } from '../web/lib/graph.js';
import { join, receive, leave, announce, storable } from '../web/lib/room.js';

// Two real browsers share one in-process board room, reached through Playwright's WebSocket
// routing, with the same room logic the Durable Object runs.
const sql = new DatabaseSync(':memory:');
for (const file of (await fs.readdir('web/drizzle')).filter(f => f.endsWith('.sql')).sort()) sql.exec(await fs.readFile(`web/drizzle/${file}`, 'utf8'));
const db = {
  prepare(query) { return { bind(...args) { const stmt = sql.prepare(query); return { first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }), run: async () => ({ meta: stmt.run(...args) }) }; } }; },
  async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; } catch (e) { sql.exec('ROLLBACK'); throw e; } }
};
let room = [], selectionSentAt = 0;
const kicked = [];
const BOARD_ROOM = { idFromName: id => id, get: () => ({ async fetch(url, init) {
  for (const socket of announce(room, JSON.parse(init.body))) { kicked.push(socket.meta.userId); socket.route.close({ code: 4003, reason: 'Removed from this board' }); }
  return new Response(null, { status: 204 });
} }) };
globalThis.__bloomLiveEnv = { DB: db, BOARD_ROOM };
const hooks = registerHooks({ resolve(specifier, context, next) { return specifier === 'cloudflare:workers' ? { url: 'data:text/javascript,export const env = globalThis.__bloomLiveEnv;', shortCircuit: true } : next(specifier, context); } });
const { handleApi, liveMember } = await import('../web/lib/boards.js');
const alice = { userId: 'email:alice@example.com', email: 'alice@example.com', displayName: 'Alice Example' }, bob = { userId: 'bob', displayName: 'Bob Builder' };
const call = (who, segments, body) => withIdentity(who, () => handleApi(new Request(`http://localhost/api/${segments.join('/')}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), segments));
const original = newGraph(true); original.title = 'Live board';
const { id } = await call(alice, ['boards'], { graph: original });
sql.prepare('INSERT INTO members (board_id, user_id, name, role, seen, color) VALUES (?, ?, ?, ?, 0, 1)').run(id, 'bob', 'Bob Builder', 'editor');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    try {
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
      const result = await withIdentity(req.headers['x-test-user'] === 'bob' ? bob : alice, () => handleApi(request, url.pathname.slice(5).split('/')));
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
    return;
  }
  const file = path.resolve('web/public', url.pathname === '/' ? 'index.html' : '.' + url.pathname);
  if (!file.startsWith(path.resolve('web/public') + path.sep)) return res.writeHead(404).end();
  try { const data = await fs.readFile(file); res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html' }); res.end(data); } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
// The room endpoint, as the browser Worker and Durable Object provide it.
async function routeRoom(context, who) {
  await context.routeWebSocket(/\/api\/boards\/[^/]+\/live/, async route => {
    const url = new URL(route.url()), member = await withIdentity(who, () => liveMember(decodeURIComponent(url.pathname.split('/')[3]), new Request(url)));
    const socket = { route, meta: storable({ id: url.searchParams.get('session'), userId: member.userId, name: member.name, color: member.color }), send: text => route.send(text) };
    room.push(socket); join(room, socket);
    route.onMessage(message => { if (message === 'ping') { route.send('pong'); return; } const change = receive(room, socket, String(message)); if (change) socket.meta = storable({ ...socket.meta, ...change }); if (change?.select?.ids.length) selectionSentAt ||= Date.now(); });
    route.onClose(() => { leave(room, socket); room = room.filter(s => s !== socket); });
  });
}
try {
  const a = await browser.newContext({ viewport: { width: 1400, height: 950 } }), b = await browser.newContext({ viewport: { width: 1400, height: 950 }, extraHTTPHeaders: { 'x-test-user': 'bob' } });
  await routeRoom(a, alice); await routeRoom(b, bob);
  const pageA = await a.newPage(), pageB = await b.newPage(), errors = [];
  for (const page of [pageA, pageB]) page.on('pageerror', e => errors.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}/?board=${id}`;
  await Promise.all([pageA.goto(url), pageB.goto(url)]);
  const fa = pageA.frameLocator('iframe'), fb = pageB.frameLocator('iframe'), node = original.nodes[0].id, other = original.nodes[1];
  await Promise.all([fa.locator(`[data-node="${node}"]`).waitFor(), fb.locator(`[data-node="${node}"]`).waitFor()]);
  const wait = async (f, what = 'collaboration state') => { for (let i = 0; i < 400; i++) { if (await f()) return; await new Promise(r => setTimeout(r, 25)); } throw Error('Timed out waiting for ' + what); };
  await wait(() => room.length === 2, 'both browsers in the room');
  const frameB = pageB.frames()[1];

  // A cursor appears where Alice points, named and in her colour.
  await pageA.mouse.move(600, 500);
  await wait(async () => await fb.locator('.remote-cursor:not([hidden])').count() === 1, 'Alice’s cursor');
  const cursorB = fb.locator('.remote-cursor');
  assert.equal(await cursorB.locator('.remote-cursor-name').innerText(), 'Alice Example');
  assert.equal(await cursorB.evaluate(el => el.style.getPropertyValue('--person')), '#dc2626');
  const at = () => cursorB.evaluate(el => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform); return { x: +m[1], y: +m[2] }; });
  await wait(async () => { const p = await at(); return Math.abs(p.x - 600) < 1 && Math.abs(p.y - 500) < 1; }, 'the cursor to settle where Alice points');

  // A steady sweep arrives as uneven network messages but is drawn as continuous movement.
  const recording = frameB.evaluate(() => new Promise(resolve => {
    const el = document.querySelector('.remote-cursor'), points = [], start = performance.now();
    const step = () => { const m = /translate\(([-\d.]+)px/.exec(el.style.transform); points.push(+m[1]); const settled = points.length > 20 && points.slice(-20).every(x => Math.abs(x - 1000) < 0.5); if (!settled && performance.now() - start < 8000) requestAnimationFrame(step); else resolve(points); };
    requestAnimationFrame(step);
  }));
  for (let i = 1; i <= 40; i++) { await pageA.mouse.move(600 + i * 10, 500); await new Promise(r => setTimeout(r, 20)); }
  const points = await recording, jumps = points.slice(1).map((x, i) => x - points[i]);
  assert.ok(Math.abs(points.at(-1) - 1000) < 1, `the cursor ends where Alice stopped (${points.at(-1)})`);
  assert.ok(Math.min(...jumps) > -0.01, 'the cursor never jumps backwards');
  assert.ok(Math.max(...jumps) < 24, `no visible jump between frames (largest ${Math.max(...jumps).toFixed(1)}px)`);
  assert.ok(jumps.filter(d => d > 0.01).length > 25, 'the movement is spread across many frames');
  console.log(`PASS: cursor sweep drawn over ${jumps.filter(d => d > 0.01).length} frames, largest step ${Math.max(...jumps).toFixed(1)}px`);

  // Selections show at once, without waiting for the next sync.
  // (Timed from when Alice's browser sends it: Playwright first waits for the wobbling blob to settle.)
  await fa.locator(`[data-node="${other.id}"]`).click();
  await wait(async () => /remote-selected/.test(await fb.locator(`[data-node="${other.id}"]`).getAttribute('class')), 'the live selection');
  const selectDelay = Date.now() - selectionSentAt;
  assert.ok(selectDelay < 1000, `selection took ${selectDelay}ms`);

  // Committed changes are pushed: Bob sees Alice's edit long before the 15-second safety sync.
  const before = await fb.locator(`[data-node="${node}"]`).getAttribute('aria-label');
  const editedAt = Date.now();
  await call(alice, ['boards', id, 'edit'], { baseRevision: sql.prepare('SELECT revision FROM boards').get().revision, operations: [{ type: 'updateNode', id: node, text: 'Pushed to Bob' }] });
  await wait(async () => await fb.locator(`[data-node="${node}"]`).getAttribute('aria-label') === 'Pushed to Bob', 'the pushed edit');
  assert.notEqual(before, 'Pushed to Bob');
  const pushDelay = Date.now() - editedAt;
  assert.ok(pushDelay < 1500, `edit reached Bob after ${pushDelay}ms`);
  assert.equal(await fb.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true, 'Alice’s edit is not Bob’s to undo');
  console.log(`PASS: selection shown after ${selectDelay}ms, edit pushed after ${pushDelay}ms`);

  // Choosing Alice in Bob's people list brings her pointer to the middle of his screen.
  await pageA.mouse.move(200, 850); await new Promise(r => setTimeout(r, 400));
  await fb.getByRole('button', { name: 'Go to Alice Example' }).click();
  assert.equal(await fb.getByRole('button', { name: 'Go to Alice Example' }).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(220, 38, 38)', 'the hovered avatar keeps its colour');
  await wait(async () => { const p = await at(); return Math.abs(p.x - 700) < 3 && Math.abs(p.y - (76 + (950 - 76) / 2)) < 3; }, 'Bob’s view to centre on Alice');
  await fs.mkdir('artifacts', { recursive: true }); await pageB.screenshot({ path: 'artifacts/bloom-live-cursor.png' });

  // Pointing outside the board hides the cursor; leaving removes it and the live selection.
  await pageA.mouse.move(700, 30);
  await wait(async () => await fb.locator('.remote-cursor:not([hidden])').count() === 0, 'the hidden cursor');
  await pageA.mouse.move(650, 520); await wait(async () => await fb.locator('.remote-cursor:not([hidden])').count() === 1, 'the returning cursor');
  await pageA.close();
  await wait(async () => await fb.locator('.remote-cursor').count() === 0, 'Alice’s cursor to leave');
  await wait(async () => !/remote-selected/.test(await fb.locator(`[data-node="${other.id}"]`).getAttribute('class')), 'Alice’s selection to leave');

  // A removed member is disconnected from the room at once.
  await call(alice, ['boards', id, 'member'], { userId: 'bob' });
  assert.deepEqual(kicked, ['bob']);
  await wait(() => room.length === 0, 'Bob’s room connection to close');
  assert.deepEqual(errors, []);
  console.log('PASS: named, coloured and smooth live cursors, instant selections, pushed edits, go-to-person, hide on leaving the board, and removal');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); hooks.deregister(); delete globalThis.__bloomLiveEnv; sql.close(); }
