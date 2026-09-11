# Cloudflare deployment and handoff

## Status

Both Workers and D1 are deployed in account `176f6319b68a88de047649d365cd1a61`. No paid subscription was activated.

- Human app: `https://bloom.theothersam.workers.dev`. Returns **503** until Cloudflare Access is configured; no board data or static assets are served before authentication.
- MCP: `https://bloom-mcp.theothersam.workers.dev/mcp?board=BOARD_ID`. Live, protected by board-scoped bearer tokens.
- D1: `bloom`, ID `8f8c4b7f-dbbd-4825-a0cf-c542aeab5ca4`, WEUR. Both migrations applied.
- Imported board: `900b678e-3fbd-4f1c-a717-77a63c7d8f47`, 15 ideas and 14 connections, owned by `email:theothersam@gmail.com`. Imported from the local desktop backup; the visible old Site's node IDs and text were checked against it. Remote MCP readback confirmed the counts and revision 0.

The old private Site remains running as a fallback. It is a separate database, with no ongoing replication. Further changes there must be exported/imported before treating Cloudflare as the current board.

## Finish human sign-in

Firefox Computer Use was stopped by the tool because its browser URL policy is unsupported. Wrangler OAuth can deploy Workers and D1, but Access organization reads and application creation returned HTTP 403. It cannot complete this step using that credential.

In Cloudflare Zero Trust, enable the **Free** plan, configure a team domain and Email one-time PIN as a login method. Create a self-hosted Access application for `bloom.theothersam.workers.dev`, allowing `theothersam@gmail.com` initially. Do not protect the MCP hostname with interactive login. Cloudflare documents [protecting workers.dev with Access](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

Set `ACCESS_ISSUER` in `cloudflare/browser.jsonc` to `https://YOUR-TEAM.cloudflareaccess.com`, and `ACCESS_AUD` to the Access application's audience (AUD) tag. Both values are non-secret. Run `npm run cf:deploy:browser` from `web/`. Then open the human URL with `?board=900b678e-3fbd-4f1c-a717-77a63c7d8f47`, sign in, and verify the imported board.

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

Pending after Access setup: real email login, a second human's invitation and collaboration, human-to-agent updates and PNG capture, and the actual Hermes Discord gateway connection. Production CPU telemetry was also denied (403); deployment startup time is not request CPU time. Live small-board requests succeeded, but representative large-board CPU measurements remain necessary before declaring every workload suitable for the Free plan. History, polling and image budgets are described in README.md.

For a database backup, use `npx wrangler d1 export bloom --remote --config cloudflare/browser.jsonc --output ../artifacts/bloom-cloudflare-backup.sql`. Keep backups private. Changes to source can be redeployed from Git history; a Worker rollback does not restore database content.
