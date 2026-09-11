import fs from 'node:fs/promises';
import { cfApi, accountId } from './cf-api.mjs';

const owner = process.env.BLOOM_OWNER_EMAIL?.trim().toLowerCase();
if (!owner || !owner.includes('@')) throw new Error('Set BLOOM_OWNER_EMAIL to the verified email that should own Bloom.');
const prefix = `/accounts/${accountId}/access`;
// Requires an API token with Access Apps/Policies and Organizations/Identity Providers permissions.
// Wrangler's ordinary deployment login does not grant these Access write permissions.
const organization = await cfApi(`${prefix}/organizations`);
if (!organization?.auth_domain) throw new Error('Enable the Zero Trust Free plan in Cloudflare first.');
const providers = await cfApi(`${prefix}/identity_providers`);
let provider = providers.find(p => p.type === 'onetimepin');
if (!provider) provider = await cfApi(`${prefix}/identity_providers`, 'POST', { name: 'Email login code', type: 'onetimepin', config: {} });
const apps = await cfApi(`${prefix}/apps`);
const existing = apps.find(app => app.domain === 'bloom.theothersam.workers.dev');
const app = existing || await cfApi(`${prefix}/apps`, 'POST', {
  type: 'self_hosted', name: 'Bloom', domain: 'bloom.theothersam.workers.dev', session_duration: '24h',
  allowed_idps: [provider.id], auto_redirect_to_identity: true,
  policies: [{ name: 'Bloom owner', decision: 'allow', include: [{ email: { email: owner } }] }]
});
if (!app.aud) throw new Error('Cloudflare did not return an Access audience tag.');
const file = new URL('../cloudflare/browser.jsonc', import.meta.url);
const config = JSON.parse(await fs.readFile(file, 'utf8'));
config.vars.ACCESS_ISSUER = `https://${organization.auth_domain}`;
config.vars.ACCESS_AUD = app.aud;
await fs.writeFile(file, JSON.stringify(config, null, 2) + '\n');
console.log('Bloom Access configuration saved. Deploy the browser Worker with npm run cf:deploy:browser.');
