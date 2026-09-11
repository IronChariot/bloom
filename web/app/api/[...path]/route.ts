import { handleApi } from '../../../lib/boards.js';
import { withIdentity } from '../../../lib/identity.js';
import { getChatGPTUser } from '../../chatgpt-auth';
export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try { const { path } = await context.params; return await withIdentity(await getChatGPTUser(), async () => Response.json(await handleApi(request, path), { headers: { 'Cache-Control': 'no-store' } })); }
  catch (error: any) { console.error('Board request failed:', error.message); return Response.json({ error: error.message || 'Board storage is unavailable.' }, { status: error.status || 400 }); }
}
export const GET = handle;
export const POST = handle;
