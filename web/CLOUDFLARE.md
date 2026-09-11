# Cloudflare deployment and handoff

## Status

Both Workers and D1 are deployed in account `176f6319b68a88de047649d365cd1a61`. No paid subscription was activated.

- Human app: `https://bloom.theothersam.workers.dev`. Cloudflare Access is configured and redirects visitors to email-code sign-in. No board data or static assets are served before authentication.
- MCP: `https://bloom-mcp.theothersam.workers.dev/mcp?board=BOARD_ID`. Live, protected by board-scoped bearer tokens.
- D1: `bloom`, ID `8f8c4b7f-dbbd-4825-a0cf-c542aeab5ca4`, WEUR. Both migrations applied.
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
npm run cf:deploy:agent
npm run cf:deploy:browser
node scripts/smoke-cloudflare.mjs
```

The configs contain existing account/database IDs; do not create another database for a routine deployment. Static assets ship with the human Worker; the production Cloudflare path does not run Next/Vinext SSR. The repository tracks web source directly, not a nested Git repository. Deployment is through Wrangler; GitHub push does not automatically deploy.

## Hermes handoff

Local ignored files `artifacts/hermes/bloom-hermes.yaml` and `artifacts/hermes/bloom-hermes.env` contain the exact connection configuration and secret respectively. Merge their contents into the active Hermes gateway profile's config and environment on the other machine; do not overwrite existing configuration. Restart the gateway. See [agent connection instructions](AGENT_CONNECTION.md).

The token grants editing access to the imported Cloudflare board. It is stored only as a hash in D1. The owner can pause, rotate or revoke it in Agent session after human login works. Creating a token from a browser that has no cached token also replaces the previous token. Structured graph operations work with no browser open; fresh PNGs require a visible signed-in browser.

## Verification and remaining checks

Passed: both Worker builds, 10 core tests, 2 Access/identity tests, live MCP SDK initialization and tool discovery, graph reads/edits, JSON Canvas resource, missing-image guidance, stale and concurrent edit conflicts, invalid tokens, cross-board denial, pause, replacement, revocation, Origin checks, and the human app's closed authentication gate. The live tests used a disposable board and removed it afterward. The imported board was only read during verification.

Verified on 2026-09-12 through Chrome: real owner email-code login, imported board rendering, a human edit read by the remote MCP SDK, an agent-created node appearing through browser sync, and a fresh revision-matched PNG returned by MCP. The temporary integration board was removed and the original board left open. The owner-only Access gate and MCP token checks also passed a repeat live smoke test.

The Cloudflare dashboard's MCP CPU chart showed P50 4.25 ms, P90 13.02 ms and P99 16.72 ms over its last-24-hours sample; the Worker overview reported 25 invocations and zero errors. These are limited samples across deployed versions, not proof that every workload stays within the Free plan CPU allowance. Larger boards and sustained usage still need measurement. The telemetry API remains unavailable to the Wrangler credential (403), but dashboard metrics are accessible. History, polling and image budgets are described in README.md.

Remaining external checks: a second human's actual invitation/sign-in and installing the prepared configuration on the actual Hermes Discord gateway. These require that person's allowed email and access to the other machine respectively. No second user was added to the Access allow policy during deployment.

For a database backup, use `npx wrangler d1 export bloom --remote --config cloudflare/browser.jsonc --output ../artifacts/bloom-cloudflare-backup.sql`. Keep backups private. Changes to source can be redeployed from Git history; a Worker rollback does not restore database content.
