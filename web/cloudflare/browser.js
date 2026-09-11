import { handleApi } from '../lib/boards.js';
import { withIdentity } from '../lib/identity.js';
import { cloudflareIdentity } from './auth.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const user = await cloudflareIdentity(request, env);
      if (!user) return new Response('Sign in through Cloudflare Access to open Bloom.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
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
