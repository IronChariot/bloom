import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { GraphStore, newGraph } from '../web/lib/graph.js';
import { boardCode } from '../web/public/canvas/agent-code.js';

// Exercise the real renderer and bridge against deliberately delayed responses.
const graph = newGraph(); graph.title = 'A little room for big ideas'; graph.nodes[0].text = 'Drag check';
const store = new GraphStore(graph), edits = [];
let connectionConfigured = false;
const testToken = 'ab'.repeat(32);
const snapshot = () => ({ ...store.snapshot(), boardId: 'pending-test', dirty: false,
  members: [], role: 'owner', user: { id: 'test', name: 'Test' }, agentEnabled: true, recent: [] });
const server = http.createServer(async (req, res) => {
  const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    if (url.pathname === '/api/me') return send({ userId: 'test', displayName: 'Test' });
    if (url.pathname === '/api/boards') return send({ boards: [{ id: 'pending-test', title: graph.title }] });
    if (url.pathname === '/api/agent-connection') {
      if (req.method === 'GET') return send({ configured: connectionConfigured });
      connectionConfigured = true; return send({ token: 'bloom_agent_' + testToken });
    }
    if (url.pathname.endsWith('/agent')) return send({ token: testToken, enabled: true });
    if (url.pathname === '/api/boards/pending-test') return send(snapshot());
    if (url.pathname.endsWith('/sync')) return send({ revision: store.revision, members: [], agentEnabled: true,
      ...(body.revision !== store.revision ? { state: snapshot() } : {}) });
    if (url.pathname.endsWith('/edit')) {
      edits.push({ body, commit() { store.apply(body.operations, 'Test', body.expectedRevision); send(snapshot()); },
        reject() { send({ error: 'The board changed. Your edit was not applied; try again.' }, 409); } });
      return;
    }
    return send({}, 404);
  }
  const file = path.resolve('web/public', url.pathname === '/' ? 'index.html' : '.' + url.pathname);
  if (!file.startsWith(path.resolve('web/public') + path.sep)) return res.writeHead(404).end();
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html' }); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, channel: process.env.BLOOM_TEST_BROWSER || 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?board=pending-test`);
  const frame = page.frameLocator('iframe'), node = frame.locator(`[data-node="${graph.nodes[0].id}"]`);
  await node.waitFor();
  const waitFor = async predicate => { for (let i = 0; i < 150; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 20)); } throw Error('Timed out waiting for test state'); };
  async function drop(dx, dy) {
    const box = await node.boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + 25 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 }); await page.mouse.up();
    return node.evaluate(e => { const m = e.transform.baseVal.getItem(0).matrix; return { x: m.e, y: m.f }; });
  }
  async function staysAt(target) {
    const deviation = await node.evaluate(async (element, target) => {
      const id = element.dataset.node; let max = 0;
      for (let i = 0; i < 35; i++) {
        await new Promise(requestAnimationFrame);
        const m = document.querySelector(`[data-node="${id}"]`).transform.baseVal.getItem(0).matrix;
        max = Math.max(max, Math.hypot(m.e - target.x, m.f - target.y));
      }
      return max;
    }, target);
    assert.ok(deviation < .1, `Dropped node drifted ${deviation.toFixed(2)} world units while saving`);
  }
  const first = await drop(160, 60); await waitFor(() => edits.length === 1); await staysAt(first);
  const second = await drop(90, -35); await staysAt(second);
  assert.equal(edits.length, 1, 'The second edit should wait for the first revision');
  edits[0].commit(); await waitFor(() => edits.length === 2); await staysAt(second);
  assert.equal(edits[1].body.expectedRevision, 1);
  edits[1].commit(); await waitFor(async () => await frame.locator('#save-status').innerText() === 'All changes saved'); await staysAt(second);
  assert.ok(Math.abs(store.graph.nodes[0].x - second.x) < .1);
  console.log('PASS: dropped position stays fixed through latency, two queued drags and the older save response');

  await node.focus(); await page.keyboard.press('Enter');
  await frame.getByRole('textbox', { name: 'Edit idea' }).fill('Immediate label'); await page.keyboard.press('Enter');
  await waitFor(() => edits.length === 3);
  assert.equal(await node.getAttribute('aria-label'), 'Immediate label');
  await staysAt(second); assert.equal(await node.getAttribute('aria-label'), 'Immediate label');
  edits[2].commit(); await waitFor(async () => await frame.locator('#save-status').innerText() === 'All changes saved');
  console.log('PASS: committed text remains visible while its save is pending');

  const third = await drop(-60, 80); await waitFor(() => edits.length === 4); await staysAt(third);
  const authoritative = { x: second.x - 80, y: second.y - 30 };
  store.apply([{ type: 'updateNode', id: graph.nodes[0].id, ...authoritative }], 'Other collaborator', store.revision);
  edits[3].reject();
  // Wait for the spring to settle, not merely cross its target mid-oscillation.
  await waitFor(async () => node.evaluate(async (e, p) => {
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame);
      const m = document.querySelector(`[data-node="${e.dataset.node}"]`).transform.baseVal.getItem(0).matrix;
      if (Math.hypot(m.e - p.x, m.f - p.y) >= .05) return false;
    }
    return true;
  }, authoritative));
  assert.match(await frame.locator('#toast').innerText(), /board changed/i);
  await staysAt(authoritative);
  assert.deepEqual(errors, []);
  console.log('PASS: a rejected move reconciles to the verified server position and reports the conflict');

  assert.equal(await frame.locator('#board-title').innerText(), graph.title);
  for (const width of [1400, 1000, 760]) {
    await page.setViewportSize({ width, height: 900 });
    const [heading, left, right] = await Promise.all(['.board-heading', '.header-left', '.header-right'].map(selector => frame.locator(selector).boundingBox()));
    assert.ok(Math.abs(heading.x + heading.width / 2 - width / 2) < 1, 'Board title should be centered');
    assert.ok(heading.x >= left.x + left.width && heading.x + heading.width <= right.x, 'Header groups should not overlap');
  }
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await frame.getByRole('button', { name: 'Agent session', exact: true }).click();
  await frame.getByRole('button', { name: 'Copy board code', exact: true }).click();
  await waitFor(async () => (await page.evaluate(() => navigator.clipboard.readText())).startsWith('bloom_'));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), boardCode(testToken));
  await frame.locator('.agent-setup summary').click();
  await frame.getByRole('button', { name: 'Copy one-time Hermes setup', exact: true }).click();
  await waitFor(async () => (await page.evaluate(() => navigator.clipboard.readText())).includes('mcp_servers:'));
  const setup = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(setup, /bloom_agent_/); assert.ok(!setup.includes('?board='));
  await fs.mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/bloom-header-and-agent-setup.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: centered responsive board title, copyable board code and board-independent one-time setup');
  await frame.getByRole('button', { name: 'Agent session', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const labels = ['Automatic placement', 'Explore new possibilities together', 'ArchitectureAndCollaboration', 'Wide WWW labels remain readable'];
  store.apply(labels.map((text, i) => ({ type: 'addNode', id: `leaf-${i}`, text, depth: 2 + i * 2,
    x: (i % 2 ? 320 : -320), y: (i < 2 ? -180 : 180) })), 'Agent', store.revision);
  await frame.locator('[data-node="leaf-3"]').waitFor();
  await frame.getByRole('button', { name: 'Fit board to view', exact: true }).click();
  for (let i = 0; i < labels.length; i++) {
    const rendered = await frame.locator(`[data-node="leaf-${i}"]`).evaluate(el => {
      const text = el.querySelector('text'), box = text.getBBox(), shape = el.querySelector('.bubble-shape').getBBox();
      return { lines: [...text.querySelectorAll('tspan')].map(e => e.textContent), font: parseFloat(getComputedStyle(text).fontSize),
        fits: box.x >= shape.x && box.y >= shape.y && box.x + box.width <= shape.x + shape.width && box.y + box.height <= shape.y + shape.height };
    });
    assert.equal(rendered.lines.join('').replace(/\s/g, ''), labels[i].replace(/\s/g, ''));
    assert.ok(rendered.fits, `Leaf ${i} text exceeds its bubble`); assert.ok(rendered.font >= 8);
  }
  assert.equal(edits.length, 4, 'Rendering and layout animation must not submit background edits');
  await page.screenshot({ path: 'artifacts/bloom-deep-labels.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: real font measurement, complete deep labels, readable minimum type and no background layout writes');
  store.apply([{ type: 'connect', source: 'leaf-0', target: 'leaf-1', style: 'dotted' }], 'Agent', store.revision);
  const edge = frame.locator('[data-edge]'); await edge.waitFor({ state: 'attached' });
  await waitFor(async () => !!(await edge.locator('.edge-hit').getAttribute('d')));
  const hit = await edge.locator('.edge-hit').evaluate(el => {
    const len = el.getTotalLength(), a = el.getPointAtLength(len / 2), b = el.getPointAtLength(len / 2 + 1), matrix = el.getScreenCTM();
    const p = new DOMPoint(a.x, a.y).matrixTransform(matrix), q = new DOMPoint(b.x, b.y).matrixTransform(matrix);
    const dx = q.x - p.x, dy = q.y - p.y, norm = Math.hypot(dx, dy);
    return { x: p.x - dy / norm * 4, y: p.y + dx / norm * 4 };
  });
  const iframeBox = await page.locator('iframe').boundingBox();
  assert.equal(await edge.locator('.edge').evaluate(e => getComputedStyle(e).strokeWidth), '2px');
  await page.mouse.click(hit.x + iframeBox.x, hit.y + iframeBox.y);
  await frame.getByRole('button', { name: 'Reverse arrow', exact: true }).click();
  await waitFor(() => edits.length === 5); edits[4].commit();
  await waitFor(async () => await edge.locator('.edge').getAttribute('marker-start') === 'url(#arrow-end)');
  assert.equal(await edge.locator('.edge').getAttribute('marker-end'), null);
  const stableEdgeId = store.graph.edges[0].id;
  await frame.getByRole('button', { name: 'Forward arrow', exact: true }).click();
  await waitFor(() => edits.length === 6); edits[5].commit();
  await waitFor(async () => await edge.locator('.edge').getAttribute('marker-end') === 'url(#arrow-end)');
  assert.equal(store.graph.edges[0].id, stableEdgeId); assert.equal(await edge.locator('.edge').getAttribute('marker-start'), null);
  console.log('PASS: clicking 4px beside a dotted connection selects it; both arrow directions preserve its ID');
  const leaf = frame.locator('[data-node="leaf-0"]');
  const leafBox = await leaf.boundingBox(); await page.mouse.click(leafBox.x + leafBox.width / 2, leafBox.y + 10);
  await frame.getByRole('button', { name: 'Set colour #f3af47', exact: true }).click();
  await waitFor(() => edits.length === 7); edits[6].commit();
  await waitFor(async () => await leaf.locator('.bubble-shape').getAttribute('fill') === '#f3af47');
  const base = frame.getByRole('button', { name: 'Set colour #8675ef', exact: true });
  const colorBox = await base.boundingBox();
  await page.mouse.move(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2); await page.mouse.down();
  await frame.getByRole('toolbar', { name: 'Colour shades' }).waitFor();
  assert.equal(edits.length, 7, 'Holding opens shades without applying the base colour');
  await page.mouse.up();
  const shade = frame.locator('[data-shade]').first(), chosen = await shade.getAttribute('data-shade');
  await shade.click(); await waitFor(() => edits.length === 8); edits[7].commit();
  await waitFor(async () => await leaf.locator('.bubble-shape').getAttribute('fill') === chosen);
  assert.equal(await frame.locator('.shade-picker').count(), 0);
  await base.focus(); await page.keyboard.press('ArrowUp');
  await frame.getByRole('toolbar', { name: 'Colour shades' }).waitFor();
  await page.screenshot({ path: 'artifacts/bloom-connection-and-shades.png' });
  await page.keyboard.press('Escape'); assert.equal(await frame.locator('.shade-picker').count(), 0);
  assert.equal(edits.length, 8); assert.deepEqual(errors, []);
  console.log('PASS: short colour click, half-second hold without recolouring, shade selection and keyboard dismissal');

} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
