// The board's live room pushes cursors, selections and "the board changed" nudges. It is optional:
// without a room (or while it reconnects) Bloom keeps working on its regular sync.
export const CURSOR_INTERVAL = 70;

export function createLiveChannel({ sessionId, onMessage, onStatus }) {
  let socket = null, board = null, open = false, everOpened = false, retries = 0, retryTimer, pingTimer;
  let selection = null, cursor = null, cursorTimer = null, lastCursorAt = 0;
  const send = message => { if (open && socket?.readyState === 1) socket.send(typeof message === 'string' ? message : JSON.stringify(message)); };
  const sendCursor = () => { cursorTimer = null; lastCursorAt = performance.now(); send({ t: 'cursor', ...(cursor || { x: null, y: null }) }); };
  function close() {
    clearTimeout(retryTimer); clearInterval(pingTimer); clearTimeout(cursorTimer); cursorTimer = null;
    const ws = socket; socket = null; board = null;
    if (ws) { ws.onclose = null; try { ws.close(1000); } catch {} }
    if (open) { open = false; onStatus(false); }
  }
  function connect(id) {
    close(); board = id;
    if (!id || typeof WebSocket === 'undefined') return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/boards/${encodeURIComponent(id)}/live?session=${encodeURIComponent(sessionId)}`);
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      open = true; everOpened = true; retries = 0; onStatus(true);
      if (selection) send({ t: 'select', ...selection });
      if (cursor) sendCursor();
      // Answered by the room without waking it; keeps proxies from closing an idle socket.
      pingTimer = setInterval(() => send('ping'), 30000);
    };
    ws.onmessage = event => {
      if (socket !== ws || event.data === 'pong') return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      onMessage(message);
    };
    ws.onclose = event => {
      if (socket !== ws) return;
      socket = null; clearInterval(pingTimer);
      if (open) { open = false; onStatus(false); }
      if (event.code === 4003) return; // Removed from the board.
      // A deployment without a room fails every time: try again rarely.
      const delay = everOpened ? Math.min(60000, 1000 * 2 ** retries++) : Math.min(300000, 5000 * 2 ** retries++);
      retryTimer = setTimeout(() => { if (board === id) connect(id); }, delay);
    };
  }
  return {
    connect, close,
    get open() { return open; },
    // point is in board coordinates, or null when the pointer leaves the board.
    cursor(point) {
      cursor = point;
      if (!open) return;
      const wait = CURSOR_INTERVAL - (performance.now() - lastCursorAt);
      if (wait <= 0) { clearTimeout(cursorTimer); sendCursor(); }
      else if (!cursorTimer) cursorTimer = setTimeout(sendCursor, wait);
    },
    select(next) {
      if (JSON.stringify(next) === JSON.stringify(selection)) return;
      selection = next; send({ t: 'select', ...selection });
    }
  };
}

// Live selections are fresher than the synced presence list, which stays authoritative for
// everything else and covers anyone without a live connection.
export function mergePresence(synced = [], peers = new Map(), departed = new Set(), now = Date.now()) {
  const sessions = new Map(synced.filter(p => !departed.has(p.sessionId)).map(p => [p.sessionId, p]));
  for (const peer of peers.values()) {
    if (!peer.select) continue;
    const prior = sessions.get(peer.id) || {};
    sessions.set(peer.id, { ...prior, sessionId: peer.id, userId: peer.userId, name: peer.name, color: peer.color,
      kind: peer.select.kind, ids: peer.select.ids, expires: now + 45000,
      editing: peer.select.editing, editExpires: peer.select.editing ? now + 45000 : 0 });
  }
  return [...sessions.values()];
}
