# Connecting an agent to Bloom

Configure Bloom once, then grant individual boards with a short code. Hermes discovers the tools automatically; no Bloom plugin or SKILL.md is required.

## One-time Hermes setup

Open **Agent session → One-time agent setup → Copy one-time Hermes setup**. Merge the copied YAML into the active Hermes profile's `~/.hermes/config.yaml`, preserving its other settings and MCP servers, then restart the Discord gateway once.

The copied configuration has this shape (the button supplies the actual connection key):

```yaml
mcp_servers:
  bloom:
    url: "https://bloom-mcp.theothersam.workers.dev/mcp"
    headers:
      Authorization: "Bearer YOUR_BLOOM_CONNECTION_KEY"
```

The connection key is private. You may instead put it in the profile's `~/.hermes/.env` as `BLOOM_CONNECTION_KEY=...` and use `Bearer ${BLOOM_CONNECTION_KEY}` in YAML. Hermes supports remote HTTP MCP and environment placeholders; see its [official MCP documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md). With containers or multiple profiles, use the files loaded by the running gateway.

This permanent connection initially has **no board permissions**, including boards owned by the person who created it. There is one connection key per Bloom account; using it in several agents shares the same set of board grants. The UI can replace a lost key: the old key stops working, while the new key retains previously granted boards. A copy is offered only in the browser that generated it; Bloom stores its hash, not a recoverable connection key.

## Grant a board during a conversation

On any board you own, choose **Agent session → Copy board code**. Paste the 49-character `bloom_...` code privately to Hermes, for example:

> Connect to this Bloom board using this code, then read it before making changes: [paste code]

Hermes calls `claim_board` once, receives the board ID, and can immediately use `get_board`, `edit_board` and `get_board_image`. Bloom stores the grant in D1. On a later day or after restarting Hermes, `list_boards` finds the board again; no code re-entry, config edit or gateway restart is needed for each board. The browser can be closed for structured graph work. Fresh screenshots require a visible browser on that board.

The code acts as an editing invitation: anyone with a Bloom connection key and the code can redeem it. It is deliberately suitable for sharing privately with your agent; do not put it in a public channel or in the board's node text. This grants permission, not autonomous scheduling—Hermes still needs its own task or trigger to decide when to work.

## Access controls

- **Copy board code** reuses the code, including after a browser reload. A recoverable copy is encrypted in D1 with a separate Cloudflare Worker secret.
- **Pause agent access** temporarily denies all agent access to that board; Resume restores still-valid grants.
- **Revoke board code and agent access** invalidates the code and every grant based on it. Resuming alone does not restore revoked grants.
- **Replace board code and remove existing grants** issues a new code and invalidates existing grants immediately. Share and redeem the new code to reconnect.
- **Replace connection key** changes the one-time Hermes credential for the account. This disconnects clients using the old key without deleting that account's board grants.

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

## Connection styles and petals (MCP 0.7)

New parent/child connections default to a solid arrow toward the child. Existing connections keep their appearance. Line pattern and arrowheads are independent: an edge's `pattern` is `solid` or `dotted`, while `type` is `line` (no arrow), `arrow`, `reverse`, or `both`. Legacy `type: "dotted"` means a dotted line with no arrow when `pattern` is absent.

Use `styleEdges` with an `ids` array and `pattern` and/or `arrows` (`none`, `arrow`, `reverse`, `both`). Omitted aspects remain unchanged. `updateEdge` does the same for a single `id`. `connect` also accepts an optional independent `pattern`. `colorNodes` recolours an `ids` array, and `deleteEdges` deletes an edge `ids` array. Each batch is one undoable change, including bulk styles.

Nodes can have up to eight `petals`, included in compact, targeted, full and changes-since reads. Petals have a stable `id`, `slot` (0–7 clockwise from the upper-right position), `kind` (`color`, `emoji`, `comment`) and `color`. Emoji petals carry `emoji`; comment petals carry `comment`, `author`, `createdAt`, and optional `updatedBy`/`updatedAt` (Unix milliseconds).

- `addPetal`: `nodeId`, optional short `id`, `kind`, optional `color`, plus `emoji` or nonblank `comment` as applicable. Uses the first empty slot; rejects a ninth petal.
- `updatePetal`: `nodeId`, petal `id`, optional `color`, `kind`, `emoji`, `comment`. Pass `beforeComment` when editing an existing comment to reject a stale draft. Blank colour petals may become an emoji or comment. Emoji/comment petals cannot convert into each other or silently discard their contents. Any kind may be recoloured.
- `movePetal`: `nodeId`, petal `id`, `slot`. Occupied neighbours shift clockwise into the next free position.
- `deletePetal`: `nodeId`, petal `id`.

These are content edits and use `expectedContentRevision`. Comment authors and dates are assigned by the server, not supplied by clients: human comments use their authenticated email, agent comments identify the AI collaborator. Editing preserves the original author/date and records the editor/date. Importing files preserves their historical metadata as file content; copied/pasted comment petals are new comments attributed to the person pasting. Bloom and JSON Canvas exports preserve petals and combined connection styles in their Bloom metadata.
