import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { cfApi, accountId } from './cf-api.mjs';
import { validateGraph } from '../lib/graph.js';

const [source, ownerEmail, boardId, outputDirectory] = process.argv.slice(2);
if (!source || !ownerEmail || !boardId || !outputDirectory) throw new Error('Usage: node scripts/import-cloudflare-board.mjs BACKUP EMAIL BOARD_ID PRIVATE_OUTPUT_DIRECTORY');
const graph = validateGraph(JSON.parse(await fs.readFile(source, 'utf8')));
const owner = `email:${ownerEmail.toLowerCase()}`, now = Date.now();
const query = (sql, params) => cfApi(`/accounts/${accountId}/d1/database/8f8c4b7f-dbbd-4825-a0cf-c542aeab5ca4/query`, 'POST', { sql, params });
const before = await query('SELECT id FROM boards WHERE id = ?', [boardId]);
if (before[0]?.results?.length) throw new Error('That board already exists; refusing to overwrite it or replace its token.');
const token = randomBytes(32).toString('hex');
const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
await fs.mkdir(outputDirectory, { recursive: true });
// Write the token privately before importing, so an interrupted run cannot lose it.
await fs.writeFile(`${outputDirectory}/bloom-hermes.env`, `BLOOM_TOKEN=${token}\n`, { flag: 'wx', mode: 0o600 });
await query('INSERT INTO boards (id, owner, graph, updated, agent_hash, agent_enabled) VALUES (?, ?, ?, ?, ?, 1)', [boardId, owner, JSON.stringify(graph), now, digest]);
await query('INSERT INTO members (board_id, user_id, name, role, seen) VALUES (?, ?, ?, ?, ?)', [boardId, owner, ownerEmail.toLowerCase(), 'owner', now]);
const url = `https://bloom-mcp.theothersam.workers.dev/mcp?board=${boardId}`;
await fs.writeFile(`${outputDirectory}/bloom-hermes.yaml`, `mcp_servers:\n  bloom:\n    url: "${url}"\n    headers:\n      Authorization: "Bearer \${BLOOM_TOKEN}"\n`);
console.log(`Imported ${graph.nodes.length} ideas and ${graph.edges.length} connections. Board ID: ${boardId}. Hermes files saved locally.`);
