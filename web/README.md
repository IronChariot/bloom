# Bloom web

Bloom is a hosted brainstorm canvas for people and AI agents. The canvas uses SVG with motion-driven elastic deformation. Nodes get smaller by generation; labels scale down more gently. Linking preserves existing colours and generation sizes.

## Sharing and saving

On Cloudflare, sign in through Cloudflare Access email login. Every board has its own owner and membership list. Share board creates an invitation URL; the owner can revoke invite links or remove members. Invited people must also be allowed by the Cloudflare Access policy. The browser Worker verifies signed Access JWTs before serving the shell, assets or API. Human sign-in and browser-to-agent collaboration are verified; see [Cloudflare setup](CLOUDFLARE.md). The older private Site remains available separately with ChatGPT sign-in.

Changes are saved to D1. Active visible tabs check for edits every two seconds. After thirty seconds without input they check every fifteen seconds; hidden tabs stop checking. Returning to a tab, interacting after idle, or reconnecting checks immediately. Failed requests back off up to sixty seconds. Presence is included in the same check and written at most once per twenty seconds per person. An unchanged response contains small status/presence fields, without the graph, history or image. Graph mutations use an atomic revision check, so two competing writes cannot silently overwrite one another. An edit conflict preserves text drafts for review. Undo and redo operate on the shared board history, including agent edits, rather than each person's private history.

Retained undo/redo snapshots are capped at fifty entries and 8 MiB of graph data per board, whichever is reached first. Older snapshots are physically deleted in the same transaction as each edit; new edits also remove abandoned redo branches. The migration prunes existing history and filters its stacks consistently. Current board content is preserved. Activity is derived from this retained history rather than stored as an unlimited audit trail.

Node moves, text and colour edits stay visible locally while saving. Queued edits keep their latest appearance when an earlier response arrives; confirmed server revisions and field preconditions still govern writes. Rejected edits reconcile with the server state and show a conflict message. `node tests/web-pending.mjs` from the repository root checks delayed and rejected saves using the real canvas and bridge in headless Chrome with an isolated local test server.

The menu provides new boards, import, download, duplicate, recent boards, JSON Canvas export and close. A downloaded .bloom file is an offline copy; cloud persistence does not depend on downloading. Existing desktop .bloom files import through the menu. Save and export use browser downloads.

## Agent access

Agent session provides a one-time Streamable HTTP MCP connection at `https://bloom-mcp.theothersam.workers.dev/mcp`. Configure Hermes once using **One-time agent setup**, then give it a board's 49-character code from **Copy board code**. Redeeming the code stores a persistent grant, so further boards and later visits need no config edits. The connection key alone has no board access. Board code copies remain stable across browser reloads; pause, replacement and revocation are checked on every call. See [Connecting an agent](AGENT_CONNECTION.md).

Tools: `claim_board`, `list_boards`, `get_board`, `edit_board`, `get_board_image`. Specify the granted boardId and use the revision from get_board as expectedRevision for atomic edits. Legacy board-specific bearer connections retain their four original tools and `bloom://board/current` / `bloom://board/canvas` resources. Browser WebMCP also exposes get_board and edit_board through the signed-in API when supported.

Connection keys are stored hashed. Board tokens have a lookup hash and an AES-GCM-encrypted recovery copy, bound to the board ID, so an owner can copy the same code again. The encryption key lives in the human Worker's `AGENT_CODE_KEY` secret, outside D1. Grants reference the current board-token hash; replacing or revoking a code invalidates all corresponding grants without reconfiguring any agent. The title of the current board appears in the center of the header.

Browser snapshots are generated only when an agent requests an image. A cached image is reused for up to sixty seconds if its graph revision still matches. Otherwise the next visible browser sync sees the request and uploads a PNG; the agent receives explicit stale/missing status and a fifteen-second retry suggestion. Requests coalesce for sixty seconds and only the first matching upload writes to storage. Uploads from old revisions or paused sessions are discarded. Image responses carry their timestamp and graph revision. They contain the SVG canvas; typed but uncommitted text, floating controls and offscreen nodes are not included. Read the structured graph for complete content. Images are resized to a 700 KB base64 budget; full graph JSON is limited to 1 MB of UTF-8 so both fit within D1's row limit.

## Local development

For Cloudflare deployment use `npm ci`, `npm run cf:build` and the commands in [Cloudflare setup](CLOUDFLARE.md). `npm run cf:test` validates Access JWTs and request identity isolation. `node scripts/smoke-cloudflare.mjs` checks the live MCP deployment using a disposable board, then removes it.

The older Sites development path remains available via `npm run install:ci`, `npm run build` and `npm run dev`. That dev server provides the starter's local sign-in flow. Only the legacy Sites route wrappers consume dispatcher identity. Cloudflare entrypoints verify Access JWTs or board tokens; they never trust client-invented identity headers.

The portable preview is on localhost. To test the compiled Worker separately, use a distinct Wrangler persistence directory from the dev server: two workerd processes must not share the same SQLite files. The root repository's tests/web.mjs runs against a test Worker at 127.0.0.1:8787 with synthetic dispatcher identities. Those test headers must never be used as a production authentication mechanism.

## Validation

The parent repository contains graph, deformation and MCP tests plus a browser integration test. The browser suite covers two distinct identities, denied access, invitations, member removal, invite revocation, simultaneous writes, shared undo/redo, MCP tokens and pause, generation sizing, centred auto-height editing, cross-browser updates, browser WebMCP registration/valid-invalid operations, and PNG snapshots. WebMCP registry tests use an injected test registry because the test browser does not natively implement that experimental API.

`node tests/web-efficiency.mjs` from the parent directory checks the actual browser scheduler with a controlled clock, a seeded legacy database migration, live compiled-Worker revision conflicts, fifty undo/redo operations, and demand-driven MCP images. The HTTP test uses the isolated local Worker at port 8787. The steady-state background budget is approximately 1,800 requests per visible active user-hour or 240 per idle user-hour, excluding edits, startup, retries and requested images. Hidden tabs generate no scheduled traffic. Measure CPU on the target Workers account before claiming compliance with the Free plan's per-request CPU allowance; local integration timings are not production CPU measurements.

## Source layout

- `public/canvas/app.js`, `style.css`, `deformation.js`: canvas, gestures and physics ported from the desktop prototype.
- `public/canvas/bridge.js`: browser file/clipboard operations, shared-state synchronization, invitations, snapshot capture and WebMCP.
- `lib/graph.js`: graph validation, colour inheritance on creation, saved generation metadata and operations.
- `lib/boards.js`: D1 access, authorization, revision transactions and shared history.
- `app/api/[...path]/route.ts`: authenticated board API.
- `app/mcp/route.ts`: remote MCP tools and resources.
- `db/schema.ts`, `drizzle/`: schema and deployment migrations.

Boards support text bubbles and typed connections. This iteration does not add live drag ghosts, remote cursors, offline editing, CRDT merging, arbitrary whiteboard shapes or a soft-body mesh solver. Committed moves synchronize; intermediate pointer movements stay local. A conflict requires retrying or reviewing the draft. Screenshots can be stale when everyone closes the board. Total storage still grows with the number of boards, although history per board is bounded.
