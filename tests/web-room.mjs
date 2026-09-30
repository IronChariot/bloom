// Runs the real BoardRoom Durable Object in workerd (wrangler dev) and checks every message type.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 8790 + Math.floor(Math.random() * 100), state = await mkdtemp(path.join(tmpdir(), 'bloom-room-'));
const dev = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--config', '../tests/fixtures/room-worker/wrangler.jsonc', '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', '0', '--persist-to', state], { cwd: 'web', stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; dev.stdout.on('data', d => log += d); dev.stderr.on('data', d => log += d);
try {
  for (let i = 0; i < 600 && !log.includes('Ready on'); i++) await new Promise(r => setTimeout(r, 100));
  if (!log.includes('Ready on')) throw new Error('wrangler dev did not start:\n' + log);
  const base = `ws://127.0.0.1:${port}`, http = `http://127.0.0.1:${port}`;
  const board = 'smoke-' + Date.now();
  function open(session, user, color) {
    const ws = new WebSocket(`${base}/?board=${board}&session=${session}&user=${user}&color=${color}`), inbox = [];
    ws.onmessage = e => inbox.push(e.data === 'pong' ? 'pong' : JSON.parse(e.data));
    return new Promise((resolve, reject) => { ws.onopen = () => resolve({ ws, inbox, closed: new Promise(r => ws.addEventListener('close', e => r(e.code))) }); ws.onerror = reject; });
  }
  const until = async (fn, what) => { for (let i = 0; i < 200; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timed out: ' + what); };
  const find = (box, t, extra = () => true) => box.inbox.find(m => m.t === t && extra(m));
  
  const alice = await open('a1', 'alice', 0);
  await until(() => find(alice, 'welcome'), 'alice welcome');
  assert.deepEqual(find(alice, 'welcome').peers, []);
  alice.ws.send(JSON.stringify({ t: 'select', kind: 'nodes', ids: ['n1', 'n2'], editing: 'n1' }));
  alice.ws.send(JSON.stringify({ t: 'cursor', x: 10.123, y: -20 }));
  await new Promise(r => setTimeout(r, 100));
  const bob = await open('b1', 'bob', 1);
  const welcome = await until(() => find(bob, 'welcome'), 'bob welcome');
  assert.equal(welcome.peers.length, 1);
  assert.deepEqual(welcome.peers[0], { id: 'a1', userId: 'alice', name: 'alice', color: 0, select: { kind: 'nodes', ids: ['n1', 'n2'], editing: 'n1' }, cursor: { x: 10.1, y: -20 } });
  await until(() => find(alice, 'join', m => m.peer.id === 'b1'), 'alice hears bob join');
  
  bob.ws.send(JSON.stringify({ t: 'cursor', x: 5, y: 6 }));
  await until(() => find(alice, 'cursor', m => m.id === 'b1' && m.x === 5 && m.y === 6), 'alice sees bob cursor');
  bob.ws.send(JSON.stringify({ t: 'cursor', x: null }));
  await until(() => find(alice, 'cursor', m => m.id === 'b1' && m.x === null), 'bob cursor hidden');
  bob.ws.send(JSON.stringify({ t: 'select', kind: 'edges', ids: ['e1', 7, 'e1'], editing: 3 }));
  const sel = await until(() => find(alice, 'select', m => m.id === 'b1'), 'alice sees bob select');
  assert.deepEqual(sel, { t: 'select', id: 'b1', kind: 'edges', ids: ['e1'], editing: null });
  assert.equal(bob.inbox.filter(m => m.t === 'cursor' && m.id === 'b1').length, 0, 'nobody hears their own cursor');
  bob.ws.send('ping'); await until(() => bob.inbox.includes('pong'), 'ping answered');
  bob.ws.send('not json'); bob.ws.send(JSON.stringify({ t: 'nonsense' }));
  
  // Workers announce committed revisions to everyone, and removed members are disconnected.
  const carol = await open('c1', 'carol', 2);
  await until(() => find(carol, 'welcome'), 'carol welcome');
  await fetch(`${http}/announce?board=${board}`, { method: 'POST', body: JSON.stringify({ type: 'rev', revision: 42 }) });
  for (const box of [alice, bob, carol]) await until(() => find(box, 'rev', m => m.revision === 42), 'rev everywhere');
  await fetch(`${http}/announce?board=${board}`, { method: 'POST', body: JSON.stringify({ type: 'kick', userId: 'carol' }) });
  assert.equal(await carol.closed, 4003);
  await until(() => find(alice, 'leave', m => m.id === 'c1'), 'alice hears carol leave');
  
  // Hibernated state survives: a newcomer still hears the stored selection.
  bob.ws.close(1000);
  await until(() => find(alice, 'leave', m => m.id === 'b1'), 'alice hears bob leave');
  const dee = await open('d1', 'dee', 3);
  const late = await until(() => find(dee, 'welcome'), 'dee welcome');
  assert.deepEqual(late.peers.map(p => [p.id, p.select?.editing]), [['a1', 'n1']]);
  alice.ws.close(); dee.ws.close();
  console.log('PASS: real BoardRoom in workerd: welcome with stored selection and cursor, join, cursor, hide, select sanitising, ping, rev, kick with 4003, leave');
} finally {
  // On Windows, wrangler's workerd child outlives a plain kill.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(dev.pid), '/T', '/F']); else dev.kill(); await rm(state, { recursive: true, force: true }).catch(() => {}); }
