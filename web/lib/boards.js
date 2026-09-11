import { env } from 'cloudflare:workers';
import { getAuthenticatedUser } from './identity.js';
import { GraphStore, newGraph, validateGraph, fromCanvas, toCanvas } from './graph.js';
import { limitHistory } from './history.js';
export const db = () => { if (!env.DB) throw new Error('Board storage is unavailable.'); return env.DB; };
export function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export async function identity() { const user = await getAuthenticatedUser(); if (!user) fail('Sign in to open this board.', 401); return user; }
export async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
export const token = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
export async function access(id, request, ownerOnly = false, lightweight = false, includeImage = false) {
  if (!id || id.length > 100) fail('Choose a board.', 404);
  const columns = 'id, owner, revision, agent_enabled, agent_hash, image_at, image_requested, image_revision';
  const board = await db().prepare(`SELECT ${columns}${lightweight ? '' : ', graph, past, future'}${includeImage ? ', image' : ''} FROM boards WHERE id = ?`).bind(id).first(); if (!board) fail('Board not found.', 404);
  const bearer = request?.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!ownerOnly && bearer && board.agent_enabled && board.agent_hash && await hash(bearer) === board.agent_hash) return { board, user: { userId: 'agent', displayName: 'AI collaborator' }, role: 'agent' };
  const user = await identity();
  const member = await db().prepare('SELECT role FROM members WHERE board_id = ? AND user_id = ?').bind(id, user.userId).first();
  if (!member || (ownerOnly && board.owner !== user.userId)) fail('You do not have access to this board.', 403);
  return { board, user, role: member.role };
}
export async function listBoards(user) {
  const results = await db().prepare('SELECT b.id, b.graph, b.updated FROM boards b JOIN members m ON m.board_id = b.id WHERE m.user_id = ? ORDER BY b.updated DESC LIMIT 50').bind(user.userId).all();
  return results.results.map(r => ({ id: r.id, title: JSON.parse(r.graph).title, updated: r.updated }));
}
export async function snapshot(board, user, role) {
  const activity = await db().prepare('SELECT actor, kind AS message, at FROM changes WHERE board_id = ? ORDER BY revision DESC LIMIT 12').bind(board.id).all();
  const presence = await db().prepare('SELECT user_id AS id, name, role, seen FROM members WHERE board_id = ? ORDER BY seen DESC LIMIT 50').bind(board.id).all();
  return { graph: validateGraph(JSON.parse(board.graph)), revision: board.revision, boardId: board.id, role, canUndo: JSON.parse(board.past).length > 0, canRedo: JSON.parse(board.future).length > 0, activity: activity.results.reverse(), members: presence.results, user: { id: user.userId, name: user.displayName }, path: 'Cloud', dirty: false, recent: [], agentEnabled: !!board.agent_enabled };
}
export async function createBoard(user, input, title) {
  const graph = input ? input.format === 'bloom' ? validateGraph(input) : fromCanvas(input, title || 'Imported brainstorm') : newGraph();
  const id = crypto.randomUUID(), now = Date.now();
  if (new TextEncoder().encode(JSON.stringify(graph)).length > 1_000_000) fail('Board is too large.');
  await db().batch([
    db().prepare('INSERT INTO boards (id, owner, graph, updated) VALUES (?, ?, ?, ?)').bind(id, user.userId, JSON.stringify(graph), now),
    db().prepare('INSERT INTO members (board_id, user_id, name, role, seen) VALUES (?, ?, ?, ?, ?)').bind(id, user.userId, user.displayName, 'owner', now)
  ]);
  return id;
}
export async function changeBoard(board, user, role, input) {
  if (input.expectedRevision !== board.revision) fail('The board changed. Your edit was not applied; try again.', 409);
  const store = new GraphStore(JSON.parse(board.graph)); store.revision = board.revision;
  const past = JSON.parse(board.past), future = JSON.parse(board.future);
  let graph, kind;
  if (input.action === 'undo' || input.action === 'redo') {
    const source = input.action === 'undo' ? past : future, target = input.action === 'undo' ? future : past;
    const revision = source.pop(); if (revision === undefined) fail('Nothing to ' + input.action + '.');
    const record = await db().prepare('SELECT graph FROM changes WHERE board_id = ? AND revision = ?').bind(board.id, revision).first();
    if (!record) fail('This history entry is unavailable.'); graph = validateGraph(JSON.parse(record.graph)); target.push(board.revision); kind = input.action === 'undo' ? 'Undid a shared change' : 'Redid a shared change';
  } else {
    store.apply(input.operations, user.displayName, input.expectedRevision); graph = store.graph;
    past.push(board.revision); future.length = 0; kind = store.activity.at(-1).message;
  }
  const text = JSON.stringify(graph); if (new TextEncoder().encode(text).length > 1_000_000) fail('Board is too large.');
  const retained = await db().prepare('SELECT revision, length(CAST(graph AS BLOB)) AS bytes FROM changes WHERE board_id = ?').bind(board.id).all();
  const sizes = new Map(retained.results.map(row => [row.revision, row.bytes]));
  sizes.set(board.revision, new TextEncoder().encode(board.graph).length);
  limitHistory(past, future, sizes);
  // D1 batches run atomically: update graph, history stacks and physical retention together.
  const result = await db().batch([
    db().prepare('INSERT INTO changes (board_id, revision, graph, actor, at, kind) SELECT id, revision, graph, ?, ?, ? FROM boards WHERE id = ? AND revision = ?').bind(user.displayName, Date.now(), kind, board.id, board.revision),
    db().prepare('UPDATE boards SET graph = ?, revision = revision + 1, updated = ?, past = ?, future = ? WHERE id = ? AND revision = ?').bind(text, Date.now(), JSON.stringify(past), JSON.stringify(future), board.id, board.revision),
    db().prepare('DELETE FROM changes WHERE board_id = ? AND revision NOT IN (SELECT value FROM boards, json_each(boards.past) WHERE boards.id = ? UNION SELECT value FROM boards, json_each(boards.future) WHERE boards.id = ?)').bind(board.id, board.id, board.id)
  ]);
  if (!result[1].meta.changes) fail('Someone changed the board at the same time. Your edit was not applied; try again.', 409);
  return snapshot(await db().prepare('SELECT id, graph, revision, past, future, agent_enabled FROM boards WHERE id = ?').bind(board.id).first(), user, role);
}
export async function handleApi(request, segments) {
  const [section, id, action] = segments;
  if (request.method !== 'GET' && request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) fail('Cross-site writes are not allowed.', 403);
  let input = {};
  if (!['GET', 'HEAD'].includes(request.method)) { const raw = await request.text(); if (raw.length > 1_600_000) fail('Request is too large.', 413); input = raw ? JSON.parse(raw) : {}; }
  if (section === 'me') return { ...await identity(), mcpOrigin: env.MCP_ORIGIN || null };
  if (section !== 'boards') fail('Not found.', 404);
  if (!id) {
    const user = await identity();
    if (request.method === 'GET') return { boards: await listBoards(user) };
    if (request.method === 'POST') return { id: await createBoard(user, input.graph, input.title) };
    fail('Method not allowed.', 405);
  }
  if (action === 'join' && request.method === 'POST') {
    const user = await identity(); const board = await db().prepare('SELECT invite_hash FROM boards WHERE id = ?').bind(id).first();
    if (!board?.invite_hash || typeof input.token !== 'string' || await hash(input.token) !== board.invite_hash) fail('This invitation is invalid or has been revoked.', 403);
    await db().prepare('INSERT INTO members (board_id, user_id, name, role, seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT (board_id, user_id) DO UPDATE SET seen = excluded.seen').bind(id, user.userId, user.displayName, 'editor', Date.now()).run(); return { joined: true };
  }
  const { board, user, role } = await access(id, request, ['invite', 'agent', 'member'].includes(action), !!action && action !== 'edit' && action !== 'export');
  if (action === 'sync' && request.method === 'POST') {
    const now = Date.now();
    if (role !== 'agent') await db().prepare('UPDATE members SET seen = ? WHERE board_id = ? AND user_id = ? AND seen < ?').bind(now, id, user.userId, now - 20000).run();
    const members = await db().prepare('SELECT user_id AS id, name, role, seen FROM members WHERE board_id = ? ORDER BY seen DESC LIMIT 50').bind(id).all();
    const result = { revision: board.revision, members: members.results, agentEnabled: !!board.agent_enabled, captureRequested: board.agent_enabled && board.image_requested > (board.image_at || 0) && board.image_requested > now - 60000 ? board.image_requested : null };
    if (input.revision !== board.revision) {
      const full = await db().prepare('SELECT id, graph, revision, past, future, agent_enabled FROM boards WHERE id = ?').bind(id).first();
      return { ...result, state: await snapshot(full, user, role) };
    }
    return result;
  }
  if (request.method === 'GET' && !action) return snapshot(board, user, role);
  if (action === 'edit' && request.method === 'POST') return changeBoard(board, user, role, input);
  if (action === 'presence' && request.method === 'POST') { if (role !== 'agent') await db().prepare('UPDATE members SET seen = ?, name = ? WHERE board_id = ? AND user_id = ?').bind(Date.now(), user.displayName, id, user.userId).run(); return { ok: true }; }
  if (action === 'invite' && request.method === 'POST') { const value = input.revoke ? null : token(); await db().prepare('UPDATE boards SET invite_hash = ? WHERE id = ?').bind(value ? await hash(value) : null, id).run(); return { token: value }; }
  if (action === 'agent' && request.method === 'POST') {
    if (input.revoke) { await db().prepare('UPDATE boards SET agent_hash = NULL, agent_enabled = 0 WHERE id = ?').bind(id).run(); return { enabled: false }; }
    if ('enabled' in input) { await db().prepare('UPDATE boards SET agent_enabled = ? WHERE id = ?').bind(input.enabled ? 1 : 0, id).run(); return { enabled: !!input.enabled }; }
    const value = token(); await db().prepare('UPDATE boards SET agent_hash = ?, agent_enabled = 1 WHERE id = ?').bind(await hash(value), id).run(); return { token: value };
  }
  if (action === 'member' && request.method === 'POST') { if (!input.userId || input.userId === board.owner) fail('The owner cannot be removed.'); await db().prepare('DELETE FROM members WHERE board_id = ? AND user_id = ?').bind(id, input.userId).run(); return { ok: true }; }
  if (action === 'image' && request.method === 'POST') {
    if (typeof input.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(input.image) || input.image.length > 700000) fail('Invalid image.');
    if (!Number.isInteger(input.revision) || !Number.isInteger(input.requestedAt)) return { accepted: false };
    const result = await db().prepare('UPDATE boards SET image = ?, image_at = ?, image_revision = ? WHERE id = ? AND revision = ? AND image_requested = ? AND COALESCE(image_at, 0) < image_requested AND image_requested > ? AND agent_enabled = 1').bind(input.image, Date.now(), input.revision, id, input.revision, input.requestedAt, Date.now() - 60000).run();
    return { accepted: !!result.meta.changes };
  }
  if (action === 'export' && request.method === 'GET') return toCanvas(JSON.parse(board.graph));
  fail('Not found.', 404);
}
