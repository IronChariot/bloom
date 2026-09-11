import { handleMcp } from '../../lib/mcp';
import { withIdentity } from '../../lib/identity.js';
import { getChatGPTUser } from '../chatgpt-auth';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return withIdentity(await getChatGPTUser(), () => handleMcp(request)); }
export async function GET() { return new Response('Use MCP Streamable HTTP POST.', { status: 405, headers: { Allow: 'POST' } }); }
export const DELETE = GET;
