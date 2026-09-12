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

MCP 0.6 applies migration `0003_curious_captain_universe.sql` to add conservative content/layout revision baselines without changing board graphs. Live checks verify independent text/coordinate preconditions, concurrent merging without lost updates, strict legacy revision checks, net changes since a revision, deletion cascades and current/future/expired cursors. Credentials and board grants are unchanged. The 23 core tests and 2 Access tests pass. Chrome checks cover the 10px invisible connection hit area, both arrow directions, shrinking labels (8px minimum), short colour clicks, a 500ms hold to open six shades, shade selection and keyboard dismissal. Browser version: `4658b08c-ef8d-408c-be69-8c7b1925952d`; MCP version: `25454686-429a-4337-bd25-f6749a839263`. Temporary live test boards were removed.

MCP 0.7 adds independent connection patterns/arrowheads, bulk styles and persisted petals without a database migration. Existing graphs retain their line appearances; new branches use outward solid arrows. All 26 core tests, 2 Access tests, the delayed-save browser suite and the new petal browser suite pass. Chrome covers Ctrl selection, mixed style highlights, bulk undo, radial colour/emoticon menus, multiline comments, editing/recolouring/deletion, hover attribution, occupied-slot drag animation, eight-petal capacity and reload persistence. Comment edits have a text precondition to reject stale drafts. Live MCP tests verify petal operations, server-assigned attribution, capacity, ordering, deletion and incremental reads on disposable boards. Browser version: `247ac284-fac4-4430-bcfb-8c6bec0a2f26`; MCP version: `3679ba44-2821-42d1-aa23-5dbb6eb4f8d2`. Board codes and connection keys are unchanged.

Visual follow-up: browser version `f14db5ba-c680-4bcd-9f32-6d8e07121d22` anchors connections to the actual animated quadratic blob outlines, and renders larger rounded petals behind blobs with larger icons. Chrome verified 648 outline intersections across growth, wobble and drag deformation, both connection endpoints, and exposed-petal clicks, comments and drag reordering. All 26 core tests, both browser suites and both Worker builds passed. Only the browser Worker needed deployment.

Petal menu polish: browser version `f8c383a6-cebe-4ad5-a998-49d2ef6a8f9e` uses centred SVG action icons and a bin icon for Delete petal, keeping the central cross for Close. Both menus were visually checked in Chrome and the petal interaction suite passed.

Header naming and Codex setup: browser version `6eef6e95-845f-4422-8918-63cd15ee8d0e` supports click-to-rename, Enter/blur save, Escape cancellation, empty-name rejection, optimistic title display and recent-name updates. The delayed-save Chrome suite verifies draft preservation during sync, failure recovery and reload, plus board-independent Codex TOML copying with the existing connection key. All 26 core tests and both Worker builds passed. The Agent connection guide now documents user-level Codex setup; no local Codex settings or connection keys were changed.

Label fitting and download icon: browser version `c54e8d5a-531c-43c0-974b-8e34e6525216` uses the wider central area of the ellipse and shrinks intact words before resorting to balanced grapheme-safe splits at the minimum font size. Chrome verified Hallucinations? stays on one line, deep labels fit, and the new download-arrow icon renders. The 27 core tests and delayed-save UI suite passed; the final label checks also passed after the Unicode truncation adjustment.

Display names: migration `0004_lowly_baron_zemo.sql` adds account profiles. Browser version `6cea4aad-d495-44bb-9884-4c6c1e44da61` provides File menu → Your name; MCP version `427afe5a-0446-4e58-8bc5-ae19e9bfc744` resolves historical activity names in full/optional activity reads. Browser snapshots carry a board-scoped name map for comment attribution while stored author identities remain stable. Tests cover validation, authenticated self-only updates, Origin checks, names across boards, former-member attribution, existing comments/edits, activity, profile reload and same-revision presence updates. All 28 core tests, both browser suites, both builds, 2 Access tests and the extended live MCP smoke suite passed. Temporary live profiles and boards were deleted.

Undoable upload: browser version `4cdced24-bd42-41c8-94bd-53ad47aeb939` adds Upload beside Download and imports into the current board as one history entry. MCP version `e5f3fd36-0cea-4f1e-8e9a-5d443440f086` carries the shared server update; no new MCP tool or database migration is required. Tests verify 205-node imports, retained board permissions, full undo/redo, invalid/oversized file rollback, strict revision conflicts (including layout changes), an actual Chrome download/upload roundtrip and flushing unfinished text before import. All 29 core tests, import and delayed-save browser suites, both builds, 2 Access tests and the live MCP regression suite passed. Live regression fixtures were removed.

The Cloudflare dashboard's MCP CPU chart showed P50 4.25 ms, P90 13.02 ms and P99 16.72 ms over its last-24-hours sample; the Worker overview reported 25 invocations and zero errors. These are limited samples across deployed versions, not proof that every workload stays within the Free plan CPU allowance. Larger boards and sustained usage still need measurement. The telemetry API remains unavailable to the Wrangler credential (403), but dashboard metrics are accessible. History, polling and image budgets are described in README.md.

Remaining external checks: a second human's actual invitation/sign-in and installing the prepared configuration on the actual Hermes Discord gateway. These require that person's allowed email and access to the other machine respectively. No second user was added to the Access allow policy during deployment.

For a database backup, use `npx wrangler d1 export bloom --remote --config cloudflare/browser.jsonc --output ../artifacts/bloom-cloudflare-backup.sql`. Keep backups private. Changes to source can be redeployed from Git history; a Worker rollback does not restore database content.

Shared selections and editing locks: migration `0005_slimy_titania.sql` adds per-tab presence and per-node edit leases. Browser version `fa144dbb-dafd-41c3-a791-e499dccb98bf` shows red selection outlines with display names, acquires a lock before opening text editing, renews it while editing and preserves drafts on failures. MCP version `f103790f-81bd-4064-a00f-66df6134356c` enforces active human text locks inside the graph/history transaction. Presence has no graph revision or Undo entries. All 31 core tests, 2 Access tests, the two-browser collaboration suite, import and delayed-save browser checks, both builds and the live MCP regression suite passed. The production lock check used a disposable board and removed its fixtures. Refresh open tabs to load the new client.
