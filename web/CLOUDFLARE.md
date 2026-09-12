# Cloudflare deployment and handoff

## Status

Both Workers and D1 are deployed in account `176f6319b68a88de047649d365cd1a61`. No paid subscription was activated.

- Human app: `https://bloom.theothersam.workers.dev`. Cloudflare Access is configured and redirects visitors to email-code sign-in. No board data or static assets are served before authentication.
- MCP: `https://bloom-mcp.theothersam.workers.dev/mcp?board=BOARD_ID`. Live, protected by board-scoped bearer tokens.
- D1: `bloom`, ID `8f8c4b7f-dbbd-4825-a0cf-c542aeab5ca4`, WEUR. Migrations through `0002_brief_veda.sql` applied, including persistent agent connections and board grants.
- Imported board: `900b678e-3fbd-4f1c-a717-77a63c7d8f47`, 15 ideas and 14 connections, owned by `email:theothersam@gmail.com`. Imported from the local desktop backup; the visible old Site's node IDs and text were checked against it. Remote MCP readback confirmed the counts and revision 0.

The old private Site remains running as a fallback. It is a separate database, with no ongoing replication. Further changes there must be exported/imported before treating Cloudflare as the current board.

## Human sign-in configuration

Access was configured through the signed-in Chrome dashboard on 2026-09-12. Application ID: `8a667c42-3c82-45ec-af6c-382f7561bb2a`. The dedicated `Bloom owner` policy (`04399fb5-74f3-46de-b70b-46df805d7a89`) allows only `theothersam@gmail.com`. The application covers the Bloom Worker's production and preview URLs, uses the existing email one-time PIN provider, and has a 24-hour session. Other applications and the team settings were preserved. Wrangler OAuth still lacks Access configuration permissions; use the dashboard for policy changes.

The existing team domain is `theothersam.cloudflareaccess.com`. The organization-wide login page branding still says “amsv-systems-engineering-portal - Cloudflare Access”; the application heading correctly says “Log in to Bloom”. The MCP hostname is not protected by interactive login. Cloudflare documents [protecting workers.dev with Access](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

`ACCESS_ISSUER` and `ACCESS_AUD` are recorded in `cloudflare/browser.jsonc` and deployed. Both values are non-secret. Open the human URL with `?board=900b678e-3fbd-4f1c-a717-77a63c7d8f47` and sign in with the allowed email address. If the Access application is recreated, update its AUD in this config and redeploy.

Alternatively, after enabling Zero Trust, the prepared `npm run cf:configure-access` helper can create the owner-only app and update these variables. It needs `BLOOM_OWNER_EMAIL=theothersam@gmail.com` plus a locally configured `CLOUDFLARE_API_TOKEN` restricted to this account with **Access: Apps and Policies — Edit** and **Access: Organizations, Identity Providers, and Groups — Edit**. Keep credentials out of chat and Git. Use the existing Wrangler login for the subsequent Worker deployment if the scoped token lacks Worker permissions.

To invite another human, first add their email to the Access application's allow policy, then give them Bloom's board invitation. Access login and board membership are separate checks. The initial owner-only policy will not let arbitrary invite recipients sign in.

## Deploy from a fresh clone

Node 24 is the verified runtime. From `web/`:

```powershell
npm ci
npx wrangler login
npm run cf:build
npm run cf:test
npx wrangler d1 migrations apply bloom --remote --config cloudflare/browser.jsonc
node scripts/ensure-agent-code-key.mjs
npm run cf:deploy:agent
npm run cf:deploy:browser
node scripts/smoke-cloudflare.mjs
```

The configs contain existing account/database IDs; do not create another database for a routine deployment. Static assets ship with the human Worker; the production Cloudflare path does not run Next/Vinext SSR. The repository tracks web source directly, not a nested Git repository. Deployment is through Wrangler; GitHub push does not automatically deploy.

## Hermes handoff

Use **Agent session → One-time agent setup → Copy one-time Hermes setup** for the permanent `/mcp` connection. Add that configuration to the active Hermes gateway profile and restart once. Then share codes from **Copy board code** privately with the agent. Bloom remembers redeemed grants across reconnects. The earlier `artifacts/hermes/bloom-hermes.yaml` / `.env` files are legacy board-specific settings, not the new setup. See [agent connection instructions](AGENT_CONNECTION.md).

Connection keys grant no board permissions by themselves. Board codes authorize persistent grants to individual boards. Code rotation/revocation invalidates those grants; connection-key rotation preserves them while disconnecting the old client key. The browser Worker stores a separate encryption secret to support repeated owner copies without changing a code. `ensure-agent-code-key.mjs` preserves an existing remote secret; the private recovery copy is in ignored `artifacts/hermes/cloudflare-agent-code-key.env`. Back it up separately from D1 and never rotate it casually: existing encrypted code copies depend on it. Structured graph operations work with no browser open; fresh PNGs require a visible signed-in browser.

## Verification and remaining checks

Passed: both Worker builds, 10 core tests, 2 Access/identity tests, live MCP SDK initialization and tool discovery, graph reads/edits, JSON Canvas resource, missing-image guidance, stale and concurrent edit conflicts, invalid tokens, cross-board denial, pause, replacement, revocation, Origin checks, and the human app's closed authentication gate. The live tests used a disposable board and removed it afterward. The imported board was only read during verification.

Verified on 2026-09-12 through Chrome: real owner email-code login, imported board rendering, a human edit read by the remote MCP SDK, an agent-created node appearing through browser sync, and a fresh revision-matched PNG returned by MCP. The temporary integration board was removed and the original board left open. The owner-only Access gate and MCP token checks also passed a repeat live smoke test.

The permanent-connection flow passed live tests for empty initial permissions, code claims, idempotent redemption, reconnect persistence, two independently granted boards, writes, per-board revocation, code replacement, pause and connection-key rotation. Chrome verified that owner code copies survive reloads and do not resume a paused board. The local UI suite covers the centered header at three viewport widths and the copy controls. All temporary boards and connections were removed.

MCP 0.5 adds compact reads, targeted node/incident-edge reads and exact committed edit deltas. The deployed SDK smoke test verifies these defaults, optional layout/activity/participants, explicit full compatibility, failed-batch rollback and layout-only conflict rejection. All 18 core tests and 2 Access tests pass; the browser suite also checks full deep-leaf labels using real font measurements. On a synthetic 15-node fixture, compact read → edit delta → targeted read used 4,305 UTF-8 response bytes versus 14,641 for three full graph snapshots (71% smaller). This is a fixture payload comparison, not measured provider tokens or billing. Current graphs and credentials need no migration.

The Cloudflare dashboard's MCP CPU chart showed P50 4.25 ms, P90 13.02 ms and P99 16.72 ms over its last-24-hours sample; the Worker overview reported 25 invocations and zero errors. These are limited samples across deployed versions, not proof that every workload stays within the Free plan CPU allowance. Larger boards and sustained usage still need measurement. The telemetry API remains unavailable to the Wrangler credential (403), but dashboard metrics are accessible. History, polling and image budgets are described in README.md.

Remaining external checks: a second human's actual invitation/sign-in and installing the prepared configuration on the actual Hermes Discord gateway. These require that person's allowed email and access to the other machine respectively. No second user was added to the Access allow policy during deployment.

For a database backup, use `npx wrangler d1 export bloom --remote --config cloudflare/browser.jsonc --output ../artifacts/bloom-cloudflare-backup.sql`. Keep backups private. Changes to source can be redeployed from Git history; a Worker rollback does not restore database content.
