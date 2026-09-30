import { handleApi, liveMember } from '../lib/boards.js';
import { withIdentity } from '../lib/identity.js';
import { cloudflareIdentity } from './auth.js';
export { BoardRoom } from './room.js';

// Opens the board's live room: cursors, selections and change nudges over one WebSocket.
async function live(request, env, user, id) {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
  // Sign-in rides on a cookie, so refuse sockets opened by other sites' pages.
  if (request.headers.get('Origin') !== new URL(request.url).origin) return new Response('Cross-site connections are not allowed.', { status: 403 });
  const sessionId = new URL(request.url).searchParams.get('session');
  if (!sessionId || sessionId.length > 100) return new Response('Choose a session.', { status: 400 });
  const member = await withIdentity(user, () => liveMember(id, request));
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  const forward = new Request('https://room/connect', request);
  forward.headers.set('X-Bloom-Member', JSON.stringify({ ...member, sessionId }));
  return room.fetch(forward);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const user = await cloudflareIdentity(request, env);
      if (!user) return new Response('Sign in through Cloudflare Access to open Bloom.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
      const liveRoute = url.pathname.match(/^\/api\/boards\/([^/]+)\/live$/);
      if (liveRoute) return await live(request, env, user, decodeURIComponent(liveRoute[1]));
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
        return await withIdentity(user, async () => Response.json(await handleApi(request, url.pathname.slice(5).split('/')), { headers: { 'Cache-Control': 'private, no-store' } }));
      }
      if (url.pathname === '/mcp') return new Response('Use the dedicated MCP endpoint shown in Agent session.', { status: 404 });
      if (url.pathname === '/signin-with-chatgpt') return Response.redirect(new URL('/', url), 303);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return Response.json({ error: error.status ? error.message : 'Bloom could not complete this request.' }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
    }
  }
};
