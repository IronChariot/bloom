import { access } from '../lib/boards.js';
import { handleMcp } from '../lib/mcp.ts';
import { withIdentity } from '../lib/identity.js';

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);
    if (url.pathname !== '/mcp') return new Response('Bloom MCP endpoint: /mcp?board=BOARD_ID', { status: 404 });
    const origin = request.headers.get('Origin');
    if (origin && origin !== env.BROWSER_ORIGIN) return new Response('Origin not allowed', { status: 403 });
    if (!/^Bearer [A-Za-z0-9]{64}$/.test(request.headers.get('Authorization') || '')) return new Response('A Bloom board token is required.', { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="Bloom"' } });
    return withIdentity(null, async () => {
      try {
        const { role } = await access(url.searchParams.get('board'), request, false, true);
        if (role !== 'agent') return new Response('Invalid board token.', { status: 401 });
      } catch { return new Response('Invalid or paused board token.', { status: 401 }); }
      if (request.method !== 'POST') return new Response('Use MCP Streamable HTTP POST.', { status: 405, headers: { Allow: 'POST' } });
      if (Number(request.headers.get('Content-Length')) > 1000000) return new Response('Request too large.', { status: 413 });
      const body = await request.text();
      if (new TextEncoder().encode(body).length > 1000000) return new Response('Request too large.', { status: 413 });
      return handleMcp(new Request(request, { body }));
    });
  }
};
