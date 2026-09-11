import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const accountId = '176f6319b68a88de047649d365cd1a61';
let credential;
export async function cfApi(path, method = 'GET', body) {
  if (!path.startsWith(`/accounts/${accountId}/`)) throw new Error('This helper is restricted to the Bloom Cloudflare account.');
  credential ||= process.env.CLOUDFLARE_API_TOKEN || JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'auth', 'token', '--json'], { encoding: 'utf8' })).token;
  const response = await fetch('https://api.cloudflare.com/client/v4' + path, { method, headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`Cloudflare ${response.status}: ${JSON.stringify(result.errors)}`);
  return result.result;
}
