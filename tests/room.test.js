import test from 'node:test';
import assert from 'node:assert/strict';
import { join, receive, leave, announce, storable } from '../web/lib/room.js';
import { mergePresence } from '../web/public/canvas/live.js';
import { samplePosition } from '../web/public/canvas/cursors.js';
import { activePeople, initials, collaboratorColor } from '../web/public/canvas/collaborators.js';

const socket = (id, userId = id, extra = {}) => { const inbox = []; return { inbox, meta: { id, userId, name: userId, color: 0, ...extra }, send: text => inbox.push(JSON.parse(text)) }; };

test('the room relays cursors and selections to others, and remembers them for newcomers', () => {
  const a = socket('a'), b = socket('b'), room = [a, b];
  join(room, b);
  assert.deepEqual(b.inbox[0], { t: 'welcome', id: 'b', peers: [{ id: 'a', userId: 'a', name: 'a', color: 0, select: null, cursor: null }] });
  assert.equal(a.inbox[0].t, 'join');
  assert.deepEqual(receive(room, a, JSON.stringify({ t: 'cursor', x: 1.26, y: 1e9 })), { cursor: { x: 1.3, y: 100000 } });
  assert.deepEqual(b.inbox.at(-1), { t: 'cursor', id: 'a', x: 1.3, y: 100000 });
  assert.equal(a.inbox.length, 1, 'nobody hears their own cursor');
  assert.deepEqual(receive(room, a, JSON.stringify({ t: 'cursor', x: 'left' })), { cursor: null });
  assert.deepEqual(b.inbox.at(-1), { t: 'cursor', id: 'a', x: null, y: null });
  const change = receive(room, b, JSON.stringify({ t: 'select', kind: 'weird', ids: ['n', 'n', 3, 'x'.repeat(101), ...Array.from({ length: 300 }, (_, i) => 'id' + i)], editing: 'n' }));
  assert.equal(change.select.kind, 'nodes'); assert.equal(change.select.ids.length, 200); assert.equal(change.select.ids[0], 'n'); assert.equal(change.select.editing, 'n');
  for (const junk of ['nope', '{"t":"other"}', 'null', 'x'.repeat(20000), undefined]) assert.equal(receive(room, a, junk), null);
  const stored = storable({ ...b.meta, ...change });
  assert.ok(JSON.stringify(stored).length < 2048, 'fits a hibernation attachment');
  assert.equal(stored.select.ids.length, 12);
});

test('leaving, revisions and removed members', () => {
  const a = socket('a'), b = socket('b', 'bob'), b2 = socket('b', 'bob'), room = [a, b, b2];
  leave(room, b);
  assert.equal(a.inbox.length, 0, 'another tab of the same session is still here');
  leave([a, b2], b2);
  assert.deepEqual(a.inbox.at(-1), { t: 'leave', id: 'b' });
  assert.deepEqual(announce(room, { type: 'rev', revision: 7 }), []);
  assert.deepEqual(b.inbox.at(-1), { t: 'rev', revision: 7 });
  assert.deepEqual(announce(room, { type: 'kick', userId: 'bob' }), [b, b2]);
  assert.deepEqual(announce(room, { type: 'rev', revision: 'soon' }), []);
});

test('live selections override the synced list, and departed sessions vanish at once', () => {
  const synced = [{ sessionId: 's1', userId: 'u1', name: 'Ann', color: 2, kind: 'nodes', ids: ['old'], expires: 5, editing: 'old', editExpires: 5 }, { sessionId: 's2', userId: 'u2', name: 'Ben', kind: 'nodes', ids: ['x'], expires: 5 }, { sessionId: 's3', userId: 'u3', name: 'Cy', kind: 'nodes', ids: ['y'], expires: 5 }];
  const peers = new Map([['s1', { id: 's1', userId: 'u1', name: 'Ann', color: 2, select: { kind: 'edges', ids: ['e'], editing: null } }], ['s4', { id: 's4', userId: 'u4', name: 'Di', color: 3, select: null }]]);
  const merged = mergePresence(synced, peers, new Set(['s3']), 1000);
  assert.deepEqual(merged.map(p => p.sessionId), ['s1', 's2']);
  assert.deepEqual([merged[0].kind, merged[0].ids, merged[0].editing, merged[0].expires], ['edges', ['e'], null, 46000]);
});

test('cursors blend between samples and hold their last position', () => {
  const samples = [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: -10 }, { t: 200, x: 10, y: 10 }];
  assert.deepEqual(samplePosition(samples, -5), samples[0]);
  assert.deepEqual(samplePosition(samples, 50), { x: 5, y: -5 });
  assert.deepEqual(samplePosition(samples, 150), { x: 10, y: 0 });
  assert.deepEqual(samplePosition(samples, 999), samples[2]);
  assert.equal(samplePosition([], 1), null);
});

test('the people list shows you first, then the recently seen, with stable colours', () => {
  const people = activePeople([{ id: 'old', seen: 0 }, { id: 'me', seen: 0 }, { id: 'a', seen: 90000 }, { id: 'b', seen: 95000 }], 'me', 100000);
  assert.deepEqual(people.map(p => p.id), ['me', 'b', 'a']);
  assert.deepEqual(['Ada Lovelace', 'sam@example.com', 'jo.smith@example.com', 'x', ''].map(initials), ['AL', 'SA', 'JS', 'X', '?']);
  assert.equal(collaboratorColor(9), collaboratorColor(1)); assert.equal(collaboratorColor(undefined), collaboratorColor(0));
});
