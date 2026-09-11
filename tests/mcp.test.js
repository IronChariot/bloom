import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { GraphStore, newGraph } from '../src/graph.js';
import { startMcp } from '../electron/mcp.js';

test('MCP protocol reads, edits, screenshots, resources, stale conflicts and access controls', async () => {
  const store = new GraphStore(newGraph());
  const service = await startMcp({ getStore: () => store, screenshot: async () => 'aW1hZ2U=', getViewport: () => ({ zoom: 1 }) });
  const { url, token } = service.info(); const client = new Client({ name: 'test-agent', version: '1' });
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://example.com' } })).status, 403);
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const listed = await client.listTools(); assert.deepEqual(listed.tools.map(t => t.name), ['get_board', 'edit_board', 'get_board_image']);
    const initial = JSON.parse((await client.callTool({ name: 'get_board', arguments: {} })).content[0].text);
    const result = await client.callTool({ name: 'edit_board', arguments: { expectedRevision: initial.revision, operations: [{ type: 'addNode', id: 'agent-node', parent: initial.graph.nodes[0].id, text: 'Hello from an agent' }] } });
    assert.equal(result.isError, undefined); assert.equal(store.graph.nodes[1].text, 'Hello from an agent');
    const stale = await client.callTool({ name: 'edit_board', arguments: { expectedRevision: 0, operations: [{ type: 'deleteNodes', ids: ['agent-node'] }] } }); assert.equal(stale.isError, true); assert.equal(store.graph.nodes.length, 2);
    const image = await client.callTool({ name: 'get_board_image', arguments: {} }); assert.equal(image.content[0].type, 'image');
    const resource = await client.readResource({ uri: 'bloom://board/canvas' }); assert.equal(JSON.parse(resource.contents[0].text).nodes.length, 2);
    service.setEnabled(false); assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 401);
  } finally { await client.close(); service.close(); }
});
