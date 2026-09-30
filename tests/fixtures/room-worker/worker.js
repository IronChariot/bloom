// Test-only worker: exposes the real BoardRoom without sign-in, to exercise it in workerd.
export { BoardRoom } from '../../../web/cloudflare/room.js';
export default {
  async fetch(request, env) {
    const url = new URL(request.url), room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(url.searchParams.get('board') || 'b'));
    if (url.pathname === '/announce') return room.fetch(new Request('https://room/announce', { method: 'POST', body: await request.text() }));
    const forward = new Request('https://room/connect', request);
    forward.headers.set('X-Bloom-Member', JSON.stringify({ sessionId: url.searchParams.get('session'), userId: url.searchParams.get('user'), name: url.searchParams.get('user'), color: Number(url.searchParams.get('color')) }));
    return room.fetch(forward);
  }
};
