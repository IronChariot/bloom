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
