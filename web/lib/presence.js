// Presence is ephemeral and deliberately independent of graph revisions/history.
export const LEASE_MS = 45000;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100;
export async function readPresence(db, boardId, now = Date.now()) {
  const rows = await db.prepare(`SELECT p.session_id AS sessionId, p.user_id AS userId,
    COALESCE(f.display_name, m.name) AS name, p.kind, p.ids, p.expires,
    l.node_id AS editing, l.expires AS editExpires
    FROM presence p JOIN members m ON m.board_id = p.board_id AND m.user_id = p.user_id
    LEFT JOIN profiles f ON f.user_id = p.user_id
    LEFT JOIN edit_locks l ON l.board_id = p.board_id AND l.session_id = p.session_id AND l.user_id = p.user_id AND l.expires > ?
    WHERE p.board_id = ? AND p.expires > ? ORDER BY p.session_id LIMIT 100`).bind(now, boardId, now).all();
  return rows.results.map(({ ids, ...row }) => ({ ...row, ids: JSON.parse(ids) }));
}
export async function updatePresence(db, boardId, user, input) {
  const { sessionId, action = 'select', nodeId, token } = input;
  if (!validId(sessionId) || !['select', 'acquire', 'renew', 'release', 'leave'].includes(action)) fail('Invalid presence request.');
  if (['acquire', 'renew', 'release'].includes(action) && (!validId(nodeId) || !validId(token))) fail('Choose an idea and edit token.');
  const now = Date.now(), expires = now + LEASE_MS;
  if (action === 'leave') {
    await db.batch([
      db.prepare('DELETE FROM edit_locks WHERE board_id = ? AND session_id = ? AND user_id = ?').bind(boardId, sessionId, user.userId),
      db.prepare('DELETE FROM presence WHERE board_id = ? AND session_id = ? AND user_id = ?').bind(boardId, sessionId, user.userId)
    ]);
    return { presence: await readPresence(db, boardId), expires };
  }
  const selection = input.selection || { kind: 'nodes', ids: [] };
  if (!['nodes', 'edges'].includes(selection.kind) || !Array.isArray(selection.ids) || selection.ids.length > 1000 || !selection.ids.every(validId)) fail('Invalid selection.');
  const statements = [
    db.prepare('DELETE FROM presence WHERE board_id = ? AND expires <= ?').bind(boardId, now),
    db.prepare('DELETE FROM edit_locks WHERE board_id = ? AND expires <= ?').bind(boardId, now),
    db.prepare(`INSERT INTO presence (board_id, session_id, user_id, kind, ids, expires) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (board_id, session_id) DO UPDATE SET kind = excluded.kind, ids = excluded.ids, expires = excluded.expires WHERE presence.user_id = excluded.user_id`).bind(boardId, sessionId, user.userId, selection.kind, JSON.stringify([...new Set(selection.ids)]), expires)
  ];
  if (action === 'acquire') statements.push(db.prepare(`INSERT INTO edit_locks (board_id, node_id, session_id, user_id, token, expires)
    SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM boards, json_each(boards.graph, '$.nodes') n WHERE boards.id = ? AND json_extract(n.value, '$.id') = ?)
    AND EXISTS (SELECT 1 FROM presence WHERE board_id = ? AND session_id = ? AND user_id = ?)
    AND NOT EXISTS (SELECT 1 FROM edit_locks WHERE board_id = ? AND session_id = ? AND node_id <> ?)
    ON CONFLICT (board_id, node_id) DO UPDATE SET expires = excluded.expires
    WHERE edit_locks.session_id = excluded.session_id AND edit_locks.user_id = excluded.user_id AND edit_locks.token = excluded.token`).bind(boardId, nodeId, sessionId, user.userId, token, expires, boardId, nodeId, boardId, sessionId, user.userId, boardId, sessionId, nodeId));
  if (action === 'renew') statements.push(db.prepare('UPDATE edit_locks SET expires = ? WHERE board_id = ? AND node_id = ? AND session_id = ? AND user_id = ? AND token = ? AND expires > ?').bind(expires, boardId, nodeId, sessionId, user.userId, token, now));
  if (action === 'release') statements.push(db.prepare('DELETE FROM edit_locks WHERE board_id = ? AND node_id = ? AND session_id = ? AND user_id = ? AND token = ?').bind(boardId, nodeId, sessionId, user.userId, token));
  const results = await db.batch(statements);
  if (['acquire', 'renew'].includes(action) && !results.at(-1).meta.changes) {
    const lock = await db.prepare(`SELECT COALESCE(f.display_name, m.name) AS name FROM edit_locks l
      JOIN members m ON m.board_id = l.board_id AND m.user_id = l.user_id LEFT JOIN profiles f ON f.user_id = l.user_id
      WHERE l.board_id = ? AND l.node_id = ? AND l.expires > ?`).bind(boardId, nodeId, now).first();
    fail(lock ? `${lock.name} is editing this idea. Try again when they finish.` : 'Your editing lock expired or this idea is no longer available. Try editing again.', 423);
  }
  return { presence: await readPresence(db, boardId), expires };
}

// Applied inside the same D1 transaction as the graph update, so a lock acquired
// after the initial board read still protects its text (including deletes/Undo/import).
export function editGuard(board, graph, user, input) {
  const next = new Map(graph.nodes.map(n => [n.id, n.text]));
  const touched = JSON.parse(board.graph).nodes.filter(n => !next.has(n.id) || next.get(n.id) !== n.text).map(n => n.id);
  const lease = input.editLease;
  if (lease && (!validId(input.sessionId) || !validId(lease.nodeId) || !validId(lease.token))) fail('Invalid edit lease.');
  const now = Date.now(), own = lease ? [user.userId, input.sessionId, lease.token] : ['', '', ''];
  let sql = `NOT EXISTS (SELECT 1 FROM edit_locks l JOIN members m ON m.board_id = l.board_id AND m.user_id = l.user_id
    WHERE l.board_id = ? AND l.expires > ? AND l.node_id IN (SELECT value FROM json_each(?))
    AND NOT (l.user_id = ? AND l.session_id = ? AND l.token = ?))`;
  const args = [board.id, now, JSON.stringify(touched), ...own];
  if (lease) {
    sql += ' AND EXISTS (SELECT 1 FROM edit_locks WHERE board_id = ? AND node_id = ? AND user_id = ? AND session_id = ? AND token = ? AND expires > ?)';
    args.push(board.id, lease.nodeId, ...own, now);
  }
  return { sql, args };
}
