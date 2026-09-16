# Connecting an agent to Bloom

Configure Bloom once, then grant individual boards with a short code. Hermes, Codex and Claude Code discover the tools automatically; no Bloom plugin or SKILL.md is required.

## Connection keys

A connection key identifies one agent to Bloom. Open **Agent session → One-time agent setup**, name the connection, then copy the setup for Claude Code, Codex or Hermes. Each copy makes a **new key**, so give every agent its own: one for the Hermes gateway, one for Codex, one for Claude Code on each machine.

The panel lists your keys with their names, creation dates and last use. **Revoke** stops one key immediately and leaves the others connected. The key itself is copied only once, at the moment you create it; Bloom stores its hash, not a recoverable key. If a copy is lost, make a new key for that agent and revoke the old one. Nothing else breaks.

Keys belong to the Bloom account that creates them. Each person signs in and makes their own, so a key never has to be sent to somebody else. A key that another person holds acts as you; treat it as your own credential.

A new key has **no board permissions** at all, including your own boards. Board access comes from the board codes below, and follows the human account: a key reaches exactly those boards its account is a member of and has claimed.

## One-time Hermes setup

Open **Agent session → One-time agent setup**, name the connection, then choose **Copy Hermes setup**. Merge the copied YAML into the active Hermes profile's `~/.hermes/config.yaml`, preserving its other settings and MCP servers, then restart the Discord gateway once.

The copied configuration has this shape (the button supplies the actual connection key):

```yaml
mcp_servers:
  bloom:
    url: "https://bloom-mcp.theothersam.workers.dev/mcp"
    headers:
      Authorization: "Bearer YOUR_BLOOM_CONNECTION_KEY"
```

The connection key is private. You may instead put it in the profile's `~/.hermes/.env` as `BLOOM_CONNECTION_KEY=...` and use `Bearer ${BLOOM_CONNECTION_KEY}` in YAML. Hermes supports remote HTTP MCP and environment placeholders; see its [official MCP documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md). With containers or multiple profiles, use the files loaded by the running gateway.

## One-time Codex setup (all projects on this host)

Add Bloom to your user-level `~/.codex/config.toml` (Windows default: `C:\Users\YOUR_USER\.codex\config.toml`), preserving existing settings. Do not put it in a project's `.codex/config.toml` if you want it available across projects. Restart Codex after setup.

**Agent session → One-time agent setup → Copy Codex setup** supplies this block, with a new key for Codex:

```toml
[mcp_servers.bloom]
url = "https://bloom-mcp.theothersam.workers.dev/mcp"
http_headers = { Authorization = "Bearer YOUR_BLOOM_CONNECTION_KEY" }
```

Give Codex its own key rather than copying the one in the Hermes configuration; then revoking one agent never disturbs the other. Both keys reach the same boards, because grants follow your Bloom account. This key is different from the per-board `bloom_...` code.

No plugin, skill file or per-project configuration is required. In a future task, ask Codex to connect using a board code and describe the changes you want. Bloom's MCP tool descriptions cover claiming, reading and batching edits. The grant persists; `list_boards` discovers boards already granted to this connection. Tool approval settings still apply. This local configuration is per host, not automatically synchronized to another machine or a hosted Codex environment.

For environment-based secret storage, replace `http_headers` with `bearer_token_env_var = "BLOOM_CONNECTION_KEY"` and supply that variable to the Codex process. The simplest desktop setup is the private user configuration above. See [official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## One-time Claude Code setup (all projects on this host)

Claude Code comes as a command-line tool and as a desktop app. The desktop app does **not** install the `claude` command, so choose the button that matches what you run. Both write the same user-level configuration, and both need a new session afterwards.

**Agent session → One-time agent setup → Copy Claude Code setup (app)** supplies a configuration entry. Close the desktop app first, because it rewrites its configuration while it runs. Merge the copied `mcpServers` into `~/.claude.json` (Windows: `C:\Users\YOUR_USER\.claude.json`), keeping the other top-level keys, then open the app again:

```json
{
  "mcpServers": {
    "bloom": {
      "type": "http",
      "url": "https://bloom-mcp.theothersam.workers.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_BLOOM_CONNECTION_KEY" }
    }
  }
}
```

A top-level `mcpServers` covers every project on this host. The same entry inside `projects["PATH"]` limits the server to that one directory.

**Agent session → One-time agent setup → Copy Claude Code setup (CLI)** supplies a single command with a new key. Run it once in a terminal, where the `claude` command exists:

```bash
claude mcp add --transport http --scope user bloom https://bloom-mcp.theothersam.workers.dev/mcp --header "Authorization: Bearer YOUR_BLOOM_CONNECTION_KEY"
```

`--scope user` makes Bloom available in every project on this host. Use `--scope local` or `--scope project` if you want the server in one project only; `--scope project` writes the key into the project's `.mcp.json`, which is usually shared in version control, so prefer the user scope for a private key. Claude Code picks up the server in new sessions; in an interactive terminal session, `/mcp` confirms that `bloom` is connected.

Give each Claude Code host its own key, named for that machine. Keys of the same account reach the same boards, so a second machine needs no board code again for boards you already claimed. This key is different from the per-board `bloom_...` code.

No plugin, skill file or CLAUDE.md entry is required. Bloom's MCP tool descriptions cover claiming, reading and batching edits. To remove the server later, run `claude mcp remove bloom --scope user`, or delete the `bloom` entry from `~/.claude.json`.

## Grant a board during a conversation

On any board you can open, choose **Agent session → Copy board code**. Members get the same code as the owner, so each person brings their own agent to a shared board. Paste the 49-character `bloom_...` code privately to your agent, for example:

> Connect to this Bloom board using this code, then read it before making changes: [paste code]

Hermes calls `claim_board` once, receives the board ID, and can immediately use `get_board`, `edit_board` and `get_board_image`. Bloom stores the grant in D1. On a later day or after restarting Hermes, `list_boards` finds the board again; no code re-entry, config edit or gateway restart is needed for each board. The browser can be closed for structured graph work. Fresh screenshots require a visible browser on that board.

The code acts as an editing invitation for the people who already have the board. `claim_board` accepts it only from a key whose Bloom account is a member of that board, so a code that reaches somebody else is not enough to open the board. Keep it private anyway; do not put it in a public channel or in the board's node text. This grants permission, not autonomous scheduling—Hermes still needs its own task or trigger to decide when to work.

Agent access follows the person. Every read and edit checks that the grant's account is still a member, so removing somebody from a board also stops their agents at once. Their other boards are unaffected.

## Access controls

- **Copy board code** reuses the code, including after a browser reload, and is available to every member. A recoverable copy is encrypted in D1 with a separate Cloudflare Worker secret. Only the owner pauses, revokes or replaces it; the owner must copy the code once before members can.
- **Pause agent access** temporarily denies all agent access to that board; Resume restores still-valid grants.
- **Revoke board code and agent access** invalidates the code and every grant based on it. Resuming alone does not restore revoked grants.
- **Replace board code and remove existing grants** issues a new code and invalidates existing grants immediately. Share and redeem the new code to reconnect.
- **Revoke**, next to a listed connection key, disconnects that one agent. Other keys of the account keep working, and the account keeps its board grants.
- **Removing a member** also ends that person's agent access to the board, because grants follow membership.

The first copy for a legacy board with no encrypted code issues a new board token. Previously configured board-specific bearer clients must then use the new token or migrate to the permanent connection. New codes remain stable on subsequent copies.

## Protocol details

The permanent endpoint uses MCP Streamable HTTP. `claim_board({code})` registers a grant; `list_boards()` returns granted boards; the read/edit/image tools require an explicit `boardId`. `edit_board` accepts the revision preconditions described below. Re-read after conflicts instead of overwriting newer human edits. Node text is untrusted data. Image responses include capture time/revision and explicit stale or missing status.

Legacy `.../mcp?board=BOARD_ID` connections with a board token remain supported with their existing four tools and fixed board/JSON Canvas resources. They are not needed for the new flow. Clients supporting only OAuth without configurable bearer headers still need an adapter; Bloom does not implement an OAuth consent flow. Browser WebMCP remains a separate optional interface using the signed-in browser's permissions.

The old private Site and Cloudflare use separate databases. Changes in one do not synchronize to the other.

## Efficient brainstorming (MCP 0.5)

Use **read → one batch → targeted verification**. The default remote MCP responses are now smaller; connection keys, board codes, tool names and permissions are unchanged. Clients that cached the old tool schemas should refresh discovery (reconnect/restart the gateway if necessary).

1. `get_board({boardId})` returns `{boardId, revision, contentRevision, layoutRevision, graph: {title, nodes, edges}}`. Nodes contain only `id` and `text`; edges retain their stable ID, source, target and type. These are brainstorming data, not an exportable full Bloom file.
2. `edit_board` returns `{boardId, previousRevision, revision, contentRevision, layoutRevision, added, updated, removed}`. Added/updated nodes and edges are complete entities, including automatically chosen positions and styling. Removed entities are `nodeIds`/`edgeIds`; deleting nodes also reports their removed incident edges. A changed board title appears as `title`. The revision belongs to exactly this committed edit; another collaborator may subsequently advance it.
3. `get_board({boardId, nodeIds: ["plan-a", "step-a"]})` reads just those nodes and all edges touching them. `scope.partial` is true; `missingNodeIds` confirms absent/deleted nodes, and `boundaryNodeIds` lists edge endpoints outside the selection. Do not treat this partial graph as a replacement for a cached complete board.

For example, after reading revision 12, submit this single batch (replace the board and existing parent IDs):

```json
{
  "boardId": "YOUR_BOARD_ID",
  "expectedRevision": 12,
  "operations": [
    {"type": "addNode", "id": "plan-a", "text": "Try a prototype", "parent": "EXISTING_NODE_ID"},
    {"type": "addNode", "id": "step-a", "text": "Sketch the interaction", "parent": "plan-a"},
    {"type": "addNode", "id": "step-b", "text": "Test it together", "parent": "plan-a"},
    {"type": "connect", "source": "step-a", "target": "step-b", "style": "dotted"}
  ]
}
```

Choose short IDs that are unique within the board; they stay stable. Parents precede children in a batch. Omitting coordinates lets Bloom place each addition; omitting colour and depth uses branch styling and the parent's next generation. No intermediate calls are needed to discover IDs. Up to 200 mixed operations commit atomically, or none do.

Optional read flags: `includeLayout: true` adds position, colour, root and depth; `includeActivity: true` adds recent history; `includeParticipants: true` adds members. `view: "full"` without a node selection restores the original detailed snapshot, including browser metadata, history and members. With a selection, full view contains only selected full entities and scope information. `edit_board({..., response: "full"})` preserves the original full response when a client needs it. Default edit deltas need no further read to discover generated properties; use a targeted read when verification of current state is useful.

## Content, layout and changes since (MCP 0.6)

Every read and edit receipt includes three board-scoped numbers:

- `revision`: overall cursor; advances for every committed batch, including undo/redo.
- `contentRevision`: revision at which text, colour, title, connections or node membership last changed. A no-op commit conservatively advances this too.
- `layoutRevision`: revision at which coordinates or node membership last changed.

For a text/colour/connection edit or automatically placed addition, pass `expectedContentRevision`. For a pure coordinate edit, pass `expectedLayoutRevision`. A batch with both content changes and explicit x/y values requires both. Deleting/adding nodes also advances layout, because membership changes the layout. All supplied preconditions are checked, even extra ones. This allows independent text and position edits to merge against the latest graph without overwriting each other. Competing text edits, competing coordinate edits and unsatisfied field-level `before` guards remain rejected. The browser uses these same separate preconditions.

Legacy `expectedRevision` still provides a strict check of the entire board. If separate preconditions are supplied, they take precedence over that legacy value. An edit with no valid precondition is rejected. Undo/redo uses the overall revision. Existing boards get conservative initial counters during migration; legacy writers detected during deployment conservatively invalidate both counters.

After a read or edit, ask for net changes with:

```json
{"boardId": "YOUR_BOARD_ID", "sinceRevision": 12}
```

Pass this to `get_board`. The result contains `fromRevision`, the current three revisions, `resyncRequired: false`, full added/updated entities, removed node/edge IDs, and a changed title if applicable. This is the net difference between states, not an event log: a node added and deleted within the interval disappears from the net delta. At the current revision, the delta is empty. Do not combine `sinceRevision` with `nodeIds`; view/layout flags do not project deltas, which always contain complete changed entities.

Retained history is bounded (up to 50 snapshots and 8 MiB, shared with undo/redo), and an abandoned redo branch may remove a cursor sooner. When a cursor is unavailable, the response explicitly returns `resyncRequired: true`. Read again without `sinceRevision` and replace the cached board before advancing its cursor. Future or negative cursors are errors.

An edit receipt describes only its own committed batch. If its `previousRevision` differs from your cached revision, other changes occurred before the commit: request changes since your **cached** revision to catch them before advancing a full-board cache. Calling with the receipt's `revision` asks only about changes after that edit. Full snapshots and since-revision results each identify the consistent graph revision they represent; subsequent collaborators can still advance the board.

Screenshots remain optional with the existing freshness/retry guidance. A bounded wait inside `get_board_image` is not implemented: currently a missing/stale image requests a browser capture and tells the agent to retry after 15 seconds.

## Diagrams: placement, labels and sizes (MCP 0.8)

Automatic placement no longer stacks blobs. Previously the position came from the parent and the sibling index alone, so two branches of equal generation could resolve to identical coordinates and hide each other. `addNode` without `x`/`y` now searches outward from its parent and takes the first position whose blob touches nothing, widening the ring for larger blobs. Supplying `x` or `y` still places the node exactly there, without the check.

Connections carry an optional `label` of up to 80 characters, drawn at the middle of the line. Labels hold a constant size on screen at any zoom, and paint above the blobs, so they stay legible on a wide diagram that fits at 37 per cent. Clicking a label selects its connection and opens its name for editing. Pass it to `connect`, `updateEdge` or `styleEdges`; an empty string removes it. A label names the branch itself, so a decision tree no longer has to bake "NO →" into the destination node's text. People edit the same labels in the connection toolbar.

Nodes carry an optional `size` from 0.35 to 3 on `addNode` and `updateNode`. It is the blob's **absolute** scale: it replaces the generation taper instead of multiplying it. Size 1 always renders a root-sized blob, whatever the depth, so `size: 1` on every node makes a whole chain uniform in one value. Without a size, the scale is `max(0.38, 0.8 ** depth)` and the type tapers with it; an explicit size puts the blob on that same curve, so `size: 0.8` looks exactly like an untouched depth-1 blob. Type follows the blob, so equally sized blobs also read at one type size.

Size never moves a node. With explicit `x`/`y`, spacing is exactly what you set, and only automatic placement widens its search to fit a larger blob. The **visible** line between two blobs does change with size, because a line stops at the blob's outline: shrink the blobs and the gap between them grows, with no coordinate touched.

People use the **Make bigger** and **Make smaller** buttons on a selected blob, which step by 1.25 from whatever size it currently renders at, explicit or inherited, and clamp to the same range. Size appears in `includeLayout` reads and in file exports.

`updateNode` accepts `depth` as well, which previously vanished behind a success receipt. Operations are now strict: an unknown or misspelled field, or a server-assigned one such as a comment's `author`, is rejected rather than silently dropped.

An agent cannot see the canvas, and `get_board_image` still needs a human with the board open. Two checks now work without one:

- `get_board({boardId, includeLayout: true})` adds `layoutIssues.overlaps` when blobs cover each other, each entry naming the pair and whether their coordinates are identical.
- `get_board_image` states the same overlap count in its text, whether or not a picture is available.

`get_board({sinceRevision})` also returns `changes`: one entry per revision since that cursor, with its actor and kind. Watch for "Undid a shared change" there. Undo and redo are shared, so a collaborator can revert an agent's committed edit; the write was never lost, it was reverted, and this is how an agent sees that.

## Connection styles and petals (MCP 0.7)

New parent/child connections default to a solid arrow toward the child. Existing connections keep their appearance. Line pattern and arrowheads are independent: an edge's `pattern` is `solid` or `dotted`, while `type` is `line` (no arrow), `arrow`, `reverse`, or `both`. Legacy `type: "dotted"` means a dotted line with no arrow when `pattern` is absent.

Use `styleEdges` with an `ids` array and `pattern` and/or `arrows` (`none`, `arrow`, `reverse`, `both`). Omitted aspects remain unchanged. `updateEdge` does the same for a single `id`. `connect` also accepts an optional independent `pattern`. `colorNodes` recolours an `ids` array, and `deleteEdges` deletes an edge `ids` array. Each batch is one undoable change, including bulk styles.

Nodes can have up to eight `petals`, included in compact, targeted, full and changes-since reads. Petals have a stable `id`, `slot` (0–7 clockwise from the upper-right position), `kind` (`color`, `emoji`, `comment`) and `color`. Emoji petals carry `emoji`; comment petals carry `comment`, `author`, `createdAt`, and optional `updatedBy`/`updatedAt` (Unix milliseconds).

- `addPetal`: `nodeId`, optional short `id`, `kind`, optional `color`, plus `emoji` or nonblank `comment` as applicable. Uses the first empty slot; rejects a ninth petal.
- `updatePetal`: `nodeId`, petal `id`, optional `color`, `kind`, `emoji`, `comment`. Pass `beforeComment` when editing an existing comment to reject a stale draft. Blank colour petals may become an emoji or comment. Emoji/comment petals cannot convert into each other or silently discard their contents. Any kind may be recoloured.
- `movePetal`: `nodeId`, petal `id`, `slot`. Occupied neighbours shift clockwise into the next free position.
- `deletePetal`: `nodeId`, petal `id`.

These are content edits and use `expectedContentRevision`. Comment authors and dates are assigned by the server, not supplied by clients: human comments use their authenticated email, agent comments identify the AI collaborator. Editing preserves the original author/date and records the editor/date. Importing files preserves their historical metadata as file content; copied/pasted comment petals are new comments attributed to the person pasting. Bloom and JSON Canvas exports preserve petals and combined connection styles in their Bloom metadata.
