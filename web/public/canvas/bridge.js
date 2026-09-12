import { createPresenceClient } from './presence-client.js';
import { boardCode } from './agent-code.js';
let current, boardId, boardList = [], user, localClipboard = '', listeners = [], actions = [], viewport = {}, agentToken = null, connectionToken = null, pending = 0, started = false, imageBusy = false;
let lastInteraction = Date.now(), pollTimer, polling = false, failures = 0, rendererReady = false;
const topUrl = new URL(window.parent.location.href);
const mcpUrl = () => `${user?.mcpOrigin || location.origin}/mcp?board=${boardId}`;
const connectionUrl = () => `${user?.mcpOrigin || location.origin}/mcp`;
const blank = () => ({ graph: null, revision: 0, activity: [], recent: boardList.map(b => b.id), boardList, canUndo: false, canRedo: false, members: [] });
async function request(path, body, options = {}) {
  const response = await fetch('/api/' + path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), cache: 'no-store', ...options });
  const data = await response.json(); if (!response.ok) { const error = new Error(data.error || 'Could not reach the shared board.'); error.status = response.status; throw error; } return data;
}
function notify(next) {
  if (next.graph) boardList = boardList.map(b => b.id === (next.boardId || boardId) ? { ...b, title: next.graph.title } : b);
  current = { ...next, sessionId: collaboration.sessionId, recent: boardList.map(b => b.id), boardList };
  for (const fn of listeners) fn(current);
  const status = document.querySelector('#save-status'); if (status) status.textContent = current.graph ? pending ? 'Saving changes…' : 'All changes saved' : 'No board open';
  const presence = document.querySelector('#people'); if (presence) { const count = (current.members || []).filter(m => Date.now() - m.seen < 45000).length; presence.textContent = count > 1 ? `${count} here` : 'Share board'; }
}
const collaboration = createPresenceClient({ request, getBoard: () => boardId, receive: presence => { if (current) { current.presence = presence; actions.forEach(fn => fn({ type: 'presence', presence, sessionId: collaboration.sessionId })); } }, lost: lease => actions.forEach(fn => fn({ type: 'editLockLost', lease })) });
collaboration.start();
async function refreshList() { boardList = (await request('boards')).boards; }
async function switchBoard(id) {
  const next = await request(`boards/${id}`); await collaboration.leave(); boardId = id; agentToken = null; started = true; failures = 0; topUrl.searchParams.set('board', id); topUrl.searchParams.delete('invite'); topUrl.hash = ''; window.parent.history.replaceState({}, '', topUrl); notify(next); lastInteraction = Date.now(); schedulePoll(0);
}
async function boot() {
  user = await request('me'); await refreshList();
  const id = topUrl.searchParams.get('board'), invite = new URLSearchParams(topUrl.hash.slice(1)).get('invite') || topUrl.searchParams.get('invite');
  if (id && invite) { await request(`boards/${id}/join`, { token: invite }); await refreshList(); }
  if (id) await switchBoard(id); else if (boardList.length) await switchBoard(boardList[0].id); else { const made = await request('boards', {}); await refreshList(); await switchBoard(made.id); }
  started = true; return current;
}
function download(data, extension) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${(current.graph.title || 'Brainstorm').replace(/[<>:"/\\|?*]/g, '-')}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
async function upload() {
  const target = boardId, expectedRevision = current?.revision;
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.bloom,.canvas,.json'; input.setAttribute('aria-label', 'Import brainstorm'); input.hidden = true; document.body.append(input);
  input.addEventListener('cancel', () => input.remove(), { once: true });
  input.addEventListener('change', async () => {
    let saving = false;
    try {
      const file = input.files[0]; if (!file) return;
      // Downloads are pretty-printed, so allow formatting overhead before checking graph size.
      if (file.size > 4_000_000) throw new Error('This file is too large to import (maximum file size 4 MB).');
      let graph; try { graph = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON. Choose a downloaded Bloom board or a JSON Canvas file.'); }
      if (!graph || typeof graph !== 'object' || Array.isArray(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || (graph.format !== undefined && graph.format !== 'bloom')) throw new Error('Choose a downloaded Bloom board or a JSON Canvas file.');
      if (new TextEncoder().encode(JSON.stringify(graph)).length > 1_000_000) throw new Error('Board contents are too large (maximum 1 MB, excluding formatting).');
      if (target !== boardId) throw new Error('The open board changed while you were choosing a file. Please upload again.');
      if (pending || (target && expectedRevision !== current.revision)) throw new Error('The board changed while you were choosing a file. Please review it and upload again.');
      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 200);
      if (target) {
        pending++; saving = true; notify(current);
        const next = await request(`boards/${target}/edit`, { action: 'import', graph, title, expectedRevision });
        pending--; saving = false;
        if (target === boardId) { notify(next); actions.forEach(fn => fn({ type: 'imported' })); }
      } else {
        const result = await request('boards', { graph, title }); await refreshList(); await switchBoard(result.id);
      }
    } catch (error) {
      if (saving) { pending--; saving = false; }
      if (target && target === boardId) { try { notify(await request(`boards/${target}`)); } catch {} }
      report(error.message);
    } finally { input.remove(); }
  }, { once: true });
  input.click();
}

async function writeClipboard(text) { localClipboard = text; try { await navigator.clipboard.writeText(text); } catch { const el = document.createElement('textarea'); el.value = text; document.body.append(el); el.select(); document.execCommand('copy'); el.remove(); } }
function report(message) { actions.forEach(fn => fn({ type: 'error', message })); }
window.bloom = {
  async getState() { return started ? current : boot(); },
  selection(value) { collaboration.select(value); },
  async acquireEdit(nodeId) {
    const lease = await collaboration.acquire(nodeId);
    try { const next = await request(`boards/${lease.board}`); if (lease.board === boardId) notify(next); return lease; }
    catch (error) { await collaboration.release(lease); throw error; }
  },
  releaseEdit(lease) { return collaboration.release(lease); },
  async apply(operations, expectedRevision, editLease) {
    if (!boardId) throw new Error('Open a board first.'); lastInteraction = Date.now(); pending++; notify(current);
    const id = boardId;
    const preconditions = { expectedRevision, sessionId: collaboration.sessionId, ...(editLease ? { editLease: { nodeId: editLease.nodeId, token: editLease.token } } : {}) };
    if (current.revision === expectedRevision && Number.isInteger(current.contentRevision) && Number.isInteger(current.layoutRevision)) {
      if (operations.some(op => op.type !== 'updateNode' || op.text !== undefined || op.color !== undefined)) preconditions.expectedContentRevision = current.contentRevision;
      if (operations.some(op => ['updateNode', 'addNode'].includes(op.type) && (op.x !== undefined || op.y !== undefined))) preconditions.expectedLayoutRevision = current.layoutRevision;
    }
    try { const next = await request(`boards/${id}/edit`, { operations, ...preconditions }); pending--; if (id === boardId) notify(next); return current; }
    catch (error) { pending--; try { const next = await request(`boards/${id}`); if (id === boardId) notify(next); } catch {} throw error; }
  },
  async command(name, value) {
    if (name === 'profile') { user = await request('me'); return user; }
    if (name === 'setDisplayName') {
      user = await request('me', { displayName: value });
      if (boardId) notify(await request(`boards/${boardId}`));
      return user;
    }
    if (name === 'new' || name === 'saveAs') { const made = await request('boards', name === 'saveAs' ? { graph: current.graph } : {}); await refreshList(); await switchBoard(made.id); return; }
    if (name === 'open') return upload();
    if (name === 'recent') return switchBoard(value);
    if (name === 'close') { await collaboration.leave(); boardId = null; topUrl.search = ''; topUrl.hash = ''; window.parent.history.replaceState({}, '', topUrl); notify(blank()); return; }
    if (name === 'save') { if (current.graph) download(current.graph, 'bloom'); return; }
    if (name === 'export') { if (boardId) download(await request(`boards/${boardId}/export`), 'canvas'); return; }
    if (name === 'undo' || name === 'redo') { if (boardId) notify(await request(`boards/${boardId}/edit`, { action: name, expectedRevision: current.revision, sessionId: collaboration.sessionId })); return; }
    if (name === 'copyNodes') return writeClipboard(value);
    if (name === 'pasteNodes') { try { return await navigator.clipboard.readText(); } catch { return localClipboard; } }
    if (name === 'sessionToggle') { await request(`boards/${boardId}/agent`, { enabled: value }); current.agentEnabled = value; return window.bloom.session(); }
    if (name === 'revokeSession') { await request(`boards/${boardId}/agent`, { revoke: true }); agentToken = null; current.agentEnabled = false; return window.bloom.session(); }
    if (name === 'rotateSession') { agentToken = (await request(`boards/${boardId}/agent`, {})).token; current.agentEnabled = true; return window.bloom.session(); }
    if (name === 'copyHermes' || name === 'copyCodex' || name === 'replaceConnection') {
      if (!connectionToken || name === 'replaceConnection') connectionToken = (await request('agent-connection', { replace: name === 'replaceConnection' })).token;
      if (name === 'copyCodex') {
        await writeClipboard(`[mcp_servers.bloom]\nurl = ${JSON.stringify(connectionUrl())}\nhttp_headers = { Authorization = ${JSON.stringify('Bearer ' + connectionToken)} }\n`);
        return;
      }
      await writeClipboard(`mcp_servers:\n  bloom:\n    url: "${connectionUrl()}"\n    headers:\n      Authorization: "Bearer ${connectionToken}"\n`);
      return;
    }
    if (name === 'copyBoardCode') {
      if (!boardId) throw new Error('Open a board first.');
      const result = await request(`boards/${boardId}/agent`, { reuse: true }); agentToken = result.token; current.agentEnabled = result.enabled;
      await writeClipboard(boardCode(agentToken)); return;
    }
    if (name === 'copySession' || name === 'copyAgentToken') {
      if (!boardId) throw new Error('Open a board first.');
      if (!agentToken) agentToken = (await request(`boards/${boardId}/agent`, {})).token;
      const url = mcpUrl();
      if (name === 'copyAgentToken') { await writeClipboard(agentToken); return; }
      await writeClipboard(JSON.stringify({ mcpServers: { bloom: { url, headers: { Authorization: `Bearer ${agentToken}` } } } }, null, 2)); return;
    }
    throw new Error('Unknown action.');
  },
  async session() { const connection = await request('agent-connection'); return { url: boardId ? mcpUrl() : 'Open a board first', connectionUrl: connectionUrl(), connectionConfigured: connection.configured, canCopyConnection: !!connectionToken, enabled: !!current?.agentEnabled }; },
  viewport(value) { viewport = value; }, flushed() {},
  onState(fn) { listeners.push(fn); }, onAction(fn) { actions.push(fn); }, onAgent() {}
};
function schedulePoll(delay = pollDelay()) {
  clearTimeout(pollTimer);
  if (!document.hidden && boardId) pollTimer = setTimeout(pollBoard, delay);
}
function pollDelay() { return failures ? Math.min(60000, 2000 * 2 ** failures) : (Date.now() - lastInteraction < 30000 || current?.presence?.some(p => p.expires > Date.now() && (p.ids.length || p.editing))) ? 2000 : 15000; }
async function pollBoard() {
  if (polling) return;
  if (!started || !boardId || pending || document.hidden) { schedulePoll(); return; }
  polling = true; const id = boardId;
  try {
    const next = await request(`boards/${id}/sync`, { revision: current.revision }); failures = 0;
    if (id === boardId) { current.presence = next.presence || []; actions.forEach(fn => fn({ type: 'presence', presence: current.presence, sessionId: collaboration.sessionId })); }
    if (id !== boardId || next.revision < current.revision || pending) return;
    if (next.state) { if (next.state.revision >= current.revision) notify(next.state); }
    else { const namesChanged = (current.members || []).length !== next.members.length || next.members.some(m => !current.members?.some(old => old.id === m.id && old.name === m.name)); current.members = next.members; if(namesChanged) notify({ ...current, user: { ...current.user, name: next.members.find(m => m.id === current.user?.id)?.name || current.user?.name } }); current.agentEnabled = next.agentEnabled; const people = document.querySelector('#people'); if (people) { const count = next.members.filter(m => Date.now() - m.seen < 45000).length; people.textContent = count > 1 ? `${count} here` : 'Share board'; } }
    const status = document.querySelector('#save-status'); if (status) status.textContent = 'All changes saved';
    if (next.captureRequested) await supplyImage(id, next.captureRequested);
  } catch (error) {
    if (id !== boardId) return;
    failures++;
    const status = document.querySelector('#save-status'); if (status) status.textContent = error.status === 403 ? 'Board access removed' : 'Reconnecting… edits may need retrying';
    if (error.status === 401 || error.status === 403 || error.status === 404) { started = false; clearTimeout(pollTimer); return; }
  } finally { polling = false; if (started) schedulePoll(); }
}
for (const event of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(event, () => {
  const wasIdle = Date.now() - lastInteraction >= 30000; lastInteraction = Date.now();
  if (wasIdle) schedulePoll(0);
}, { passive: true });
document.addEventListener('visibilitychange', () => { lastInteraction = Date.now(); schedulePoll(0); });
window.addEventListener('focus', () => { lastInteraction = Date.now(); schedulePoll(0); });
window.addEventListener('online', () => { failures = 0; schedulePoll(0); });
export async function captureBoard() {
  const svg = document.querySelector('#canvas'); if (!svg || !boardId) return null;
  const copy = svg.cloneNode(true); const width = Math.min(1400, innerWidth), height = Math.round((innerHeight - 76) * width / innerWidth);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('width', innerWidth); copy.setAttribute('height', innerHeight - 76);
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style'); style.textContent = '.edge{stroke:#c5cad6;stroke-width:2;fill:none}.bubble-shape{stroke:#d4d9e3;stroke-width:1.2}.selection-ring{display:none}text{fill:#303143;font-family:Trebuchet MS,sans-serif;font-weight:600;text-anchor:middle}'; copy.prepend(style);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    const canvas = document.createElement('canvas');
    for (let scale = 1; scale >= 0.25; scale *= 0.75) {
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fafbfc'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png').split(',')[1]; if (data.length <= 700000) return data;
    }
    throw new Error('The canvas snapshot is too large.');
  } finally { URL.revokeObjectURL(url); }
}
async function supplyImage(id, requestedAt) {
  if (imageBusy || document.hidden || pending || !rendererReady) return;
  imageBusy = true; const revision = current.revision;
  try {
    // Let the renderer apply the graph received by this sync before capturing it.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (id !== boardId || revision !== current.revision || document.hidden) return;
    const image = await captureBoard();
    if (image && id === boardId && revision === current.revision && !pending && !document.hidden) await request(`boards/${id}/image`, { image, revision, requestedAt });
  } catch (error) { console.warn('Board snapshot unavailable:', error); }
  finally { imageBusy = false; }
}
const html = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
async function sharePanel() {
  if (!boardId) { report('Open a board first.'); return; }
  const panel = document.querySelector('#panels');
  panel.innerHTML = `<section class="popover session-panel"><div class="panel-heading">Share this board<button id="close-sharing" aria-label="Close sharing">×</button></div><p>Invite people to edit this board. They’ll need to sign in and be allowed by this deployment’s access policy.</p>${current.role === 'owner' ? '<button class="primary-button" id="invite-link">Copy invite link</button><button class="subtle-button" id="revoke-invite">Revoke invite links</button>' : '<p>Ask the board owner for an invite link.</p>'}<div class="activity-title">People on this board</div>${(current.members || []).map(m => `<div class="activity-item"><span>${html(m.name)}${m.id === current.user.id ? ' (you)' : ''}</span>${current.role === 'owner' && m.role !== 'owner' ? `<button data-remove-member="${html(m.id)}">Remove</button>` : html(m.role)}</div>`).join('')}</section>`;
  document.querySelector('#close-sharing').onclick = () => panel.replaceChildren();
  const invite = document.querySelector('#invite-link'); if (invite) invite.onclick = async () => { try { const { token } = await request(`boards/${boardId}/invite`, {}); const url = `${location.origin}/?board=${boardId}#invite=${token}`; await writeClipboard(url); invite.textContent = 'Invite link copied'; } catch (e) { report(e.message); } };
  const revoke = document.querySelector('#revoke-invite'); if (revoke) revoke.onclick = async () => { await request(`boards/${boardId}/invite`, { revoke: true }); revoke.textContent = 'Old invite links revoked'; };
  panel.querySelectorAll('[data-remove-member]').forEach(button => button.onclick = async () => { await request(`boards/${boardId}/member`, { userId: button.dataset.removeMember }); notify(await request(`boards/${boardId}`)); sharePanel(); });
}
try {
  await boot();
  await import('./app.js');
  rendererReady = true;
  const people = document.createElement('button'); people.id = 'people'; people.className = 'share-button'; people.textContent = 'Share board'; people.onclick = sharePanel; document.querySelector('#session-toggle').before(people);
  notify(current);
  document.addEventListener('keydown', e => { if (!(e.ctrlKey || e.metaKey) || e.target.matches('input,textarea')) return; const names = { s: 'save', o: 'open', n: 'new', w: 'close' }; const name = names[e.key.toLowerCase()]; if (name) { e.preventDefault(); actions.forEach(fn => fn({ type: 'command', name })); } });
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController(); window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
    for (const tool of [
      { name: 'get_board', description: 'Read the current shared brainstorm graph and revision.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => current },
      { name: 'edit_board', description: 'Apply an atomic batch to the shared brainstorm. Use the revision from get_board.', inputSchema: { type: 'object', properties: { operations: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object' } }, expectedRevision: { type: 'integer' } }, required: ['operations', 'expectedRevision'], additionalProperties: false }, execute: async input => window.bloom.apply(input.operations, input.expectedRevision) }
    ]) await context.registerTool(tool, { signal: lifecycle.signal });
  }
} catch (error) {
  const app = document.querySelector('#app');
  if (error.status === 401) { const returnTo = topUrl.pathname + topUrl.search + topUrl.hash; app.innerHTML = `<div class="empty"><img src="/favicon.svg" alt=""><h1>Bloom</h1><p>Sign in to open your shared brainstorms.</p><a class="primary-button" style="text-align:center;text-decoration:none" target="_top" href="/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}">Sign in with ChatGPT</a></div>`; }
  else app.innerHTML = `<div class="empty"><h1>Couldn’t open this board</h1><p>${html(error.message)}</p><a href="/" target="_top">Return to your boards</a></div>`;
}
