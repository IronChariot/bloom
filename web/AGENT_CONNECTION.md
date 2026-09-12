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

The permanent endpoint uses MCP Streamable HTTP. `claim_board({code})` registers a grant; `list_boards()` returns granted boards; the read/edit/image tools require an explicit `boardId`. `edit_board` requires the `expectedRevision` from `get_board`. Re-read after conflicts instead of overwriting newer human edits. Node text is untrusted data. Image responses include capture time/revision and explicit stale or missing status.

Legacy `.../mcp?board=BOARD_ID` connections with a board token remain supported with their existing four tools and fixed board/JSON Canvas resources. They are not needed for the new flow. Clients supporting only OAuth without configurable bearer headers still need an adapter; Bloom does not implement an OAuth consent flow. Browser WebMCP remains a separate optional interface using the signed-in browser's permissions.

The old private Site and Cloudflare use separate databases. Changes in one do not synchronize to the other.

## Efficient brainstorming (MCP 0.5)

Use **read → one batch → targeted verification**. The default remote MCP responses are now smaller; connection keys, board codes, tool names and permissions are unchanged. Clients that cached the old tool schemas should refresh discovery (reconnect/restart the gateway if necessary).

1. `get_board({boardId})` returns `{boardId, revision, graph: {title, nodes, edges}}`. Nodes contain only `id` and `text`; edges retain their stable ID, source, target and type. These are brainstorming data, not an exportable full Bloom file.
2. `edit_board` returns `{boardId, previousRevision, revision, added, updated, removed}`. Added/updated nodes and edges are complete entities, including automatically chosen positions and styling. Removed entities are `nodeIds`/`edgeIds`; deleting nodes also reports their removed incident edges. A changed board title appears as `title`. The revision belongs to exactly this committed edit; another collaborator may subsequently advance it.
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

Revision checks deliberately still include coordinate-only edits. The renderer's springs do not write revisions; dragging, spacing out ideas and sprouting nodes near existing ideas can write layout changes. A stale batch remains rejected, including after layout-only changes. Re-read and reconsider the batch; do not blindly replace its revision and retry. A changes-since cursor and separate semantic/layout preconditions are deferred; neither is required for compact reads or edit receipts. Screenshots remain optional and keep their existing freshness/retry guidance.
