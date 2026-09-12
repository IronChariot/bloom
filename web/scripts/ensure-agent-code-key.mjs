import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const existing = JSON.parse(execFileSync(process.execPath, [wrangler, 'secret', 'list', '--config', 'cloudflare/browser.jsonc'], { cwd, encoding: 'utf8' }));
if (existing.some(secret => secret.name === 'AGENT_CODE_KEY')) {
  console.log('Agent code encryption key is already configured; preserved.');
} else {
  const directory = new URL('../../artifacts/hermes/', import.meta.url);
  await fs.mkdir(directory, { recursive: true });
  const file = new URL('cloudflare-agent-code-key.env', directory);
  let key;
  try { key = (await fs.readFile(file, 'utf8')).trim().replace(/^AGENT_CODE_KEY=/, ''); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    key = randomBytes(32).toString('hex');
    await fs.writeFile(file, `AGENT_CODE_KEY=${key}\n`, { flag: 'wx', mode: 0o600 });
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid saved encryption key.');
  execFileSync(process.execPath, [wrangler, 'secret', 'put', 'AGENT_CODE_KEY', '--config', 'cloudflare/browser.jsonc'], { cwd, input: key + '\n', encoding: 'utf8' });
  console.log('Agent code encryption key configured. Private recovery copy saved outside Git.');
}
