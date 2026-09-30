// Live, ephemeral collaboration for one board: cursors, selections and "the board changed" nudges.
// Nothing here is stored or authoritative: edits, text locks and the durable presence list stay
// in D1. This module is transport-free so the Durable Object and the tests can share it.
// A socket is { send(text), meta }, where meta = { id, userId, name, color, select, cursor }.
export const MAX_MESSAGE = 16000;
const MAX_IDS = 200, validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100;
const coord = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(-100000, Math.min(100000, Math.round(value * 10) / 10)) : null;

export const peer = meta => ({ id: meta.id, userId: meta.userId, name: meta.name, color: meta.color, select: meta.select || null, cursor: meta.cursor || null });

function broadcast(sockets, sender, message) {
  const text = JSON.stringify(message);
  for (const socket of sockets) if (socket !== sender) { try { socket.send(text); } catch {} }
}

// A newcomer hears who is already here; everyone else hears about the newcomer.
export function join(sockets, socket) {
  const others = sockets.filter(s => s !== socket && s.meta.id !== socket.meta.id);
  try { socket.send(JSON.stringify({ t: 'welcome', id: socket.meta.id, peers: [...new Map(others.map(s => [s.meta.id, peer(s.meta)])).values()] })); } catch {}
  broadcast(others, socket, { t: 'join', peer: peer(socket.meta) });
}

// Relays a browser's message and returns what to remember about its sender, if anything changed.
export function receive(sockets, socket, raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return null;
  let message; try { message = JSON.parse(raw); } catch { return null; }
  if (!message || typeof message !== 'object') return null;
  const others = sockets.filter(s => s.meta.id !== socket.meta.id);
  if (message.t === 'cursor') {
    const x = coord(message.x), y = coord(message.y), cursor = x === null || y === null ? null : { x, y };
    broadcast(others, socket, { t: 'cursor', id: socket.meta.id, ...(cursor || { x: null, y: null }) });
    return { cursor };
  }
  if (message.t === 'select') {
    const kind = message.kind === 'edges' ? 'edges' : 'nodes';
    const ids = Array.isArray(message.ids) ? [...new Set(message.ids.filter(validId))].slice(0, MAX_IDS) : [];
    const select = { kind, ids, editing: validId(message.editing) ? message.editing : null };
    broadcast(others, socket, { t: 'select', id: socket.meta.id, ...select });
    return { select };
  }
  return null;
}

export function leave(sockets, socket) {
  if (sockets.some(s => s !== socket && s.meta.id === socket.meta.id)) return;
  broadcast(sockets.filter(s => s !== socket), socket, { t: 'leave', id: socket.meta.id });
}

// Messages from Bloom's own Workers, never from browsers. Returns the sockets to disconnect.
export function announce(sockets, message) {
  if (message?.type === 'rev' && Number.isInteger(message.revision)) { broadcast(sockets, null, { t: 'rev', revision: message.revision }); return []; }
  // A removed member's open connections end immediately.
  if (message?.type === 'kick' && validId(message.userId)) return sockets.filter(s => s.meta.userId === message.userId);
  return [];
}

// Hibernation attachments are limited to 2 KB, so keep only a prefix of a large selection.
export function storable(meta) {
  const select = meta.select && { ...meta.select, ids: meta.select.ids.slice(0, 12) };
  return { ...meta, name: String(meta.name).slice(0, 200), select: select || null, cursor: meta.cursor || null };
}
