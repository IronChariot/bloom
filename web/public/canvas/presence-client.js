export function createPresenceClient({ request, getBoard, receive, lost }) {
  const sessionId = crypto.randomUUID();
  let selection = { kind: 'nodes', ids: [] }, lease = null, queue = Promise.resolve(), selectionTimer;
  const enqueue = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  async function send(board, body) {
    const result = await request(`boards/${board}/presence`, { sessionId, selection, ...body }, { signal: AbortSignal.timeout(10000) });
    if (board === getBoard()) receive(result.presence);
    return result;
  }
  function expire(held, message) {
    if (lease !== held) return;
    lease = null;
    lost({ ...held, message });
    void enqueue(() => send(held.board, { action: 'release', nodeId: held.nodeId, token: held.token })).catch(() => {});
  }
  return {
    sessionId,
    select(next) {
      if (JSON.stringify(selection) === JSON.stringify(next)) return;
      selection = next; clearTimeout(selectionTimer);
      const board = getBoard();
      selectionTimer = setTimeout(() => {
        if (board && board === getBoard()) void enqueue(() => send(board, { action: 'select' })).catch(() => {});
      }, 120);
    },
    async acquire(nodeId) {
      const board = getBoard(), token = crypto.randomUUID();
      if (!board) throw new Error('Open a board first.');
      return enqueue(async () => {
        if (lease) { const previous = lease; lease = null; await send(previous.board, { action: 'release', nodeId: previous.nodeId, token: previous.token }); }
        const sentAt = Date.now();
        const result = await send(board, { action: 'acquire', nodeId, token });
        if (board !== getBoard()) { await send(board, { action: 'release', nodeId, token }); throw new Error('The open board changed.'); }
        // Use a local conservative deadline rather than assuming clocks agree.
        lease = { board, nodeId, token, deadline: sentAt + 40000 };
        return { ...lease, expires: result.expires };
      });
    },
    release(held) {
      if (!held) return Promise.resolve();
      if (lease?.token === held.token) lease = null;
      return enqueue(() => send(held.board, { action: 'release', nodeId: held.nodeId, token: held.token })).catch(() => {});
    },
    leave(board = getBoard()) {
      clearTimeout(selectionTimer); selection = { kind: 'nodes', ids: [] }; lease = null;
      if (board) return enqueue(() => send(board, { action: 'leave' })).catch(() => {});
    },
    start() {
      setInterval(() => {
        const board = getBoard(), held = lease;
        if (!board || (!held && (!selection.ids.length || document.hidden))) return;
        void enqueue(async () => {
          if (board !== getBoard() || held !== lease) return;
          try {
            const sentAt = Date.now();
            await send(board, held ? { action: 'renew', nodeId: held.nodeId, token: held.token } : { action: 'select' });
            if (held === lease && held) held.deadline = sentAt + 40000;
          } catch (error) {
            if (held && [401, 403, 404, 423].includes(error.status)) expire(held, error.message);
          }
        }).catch(() => {});
      }, 15000);
      setInterval(() => { if (lease && Date.now() >= lease.deadline) expire(lease, 'The connection paused, so your editing lock was released. Your draft is kept below.'); }, 1000);
      window.addEventListener('pagehide', () => {
        const board = getBoard();
        if (board) navigator.sendBeacon(`/api/boards/${board}/presence`, new Blob([JSON.stringify({ sessionId, action: 'leave' })], { type: 'application/json' }));
      });
    }
  };
}
