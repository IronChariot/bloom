import { createDeformation, stepDeformation, deformPoint } from './deformation.js';
const api = window.bloom;
const icons = {
 pointer: '<path d="m5 3 14 9-7 1-3 7z"/>', plus: '<path d="M12 5v14M5 12h14"/>', hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v9c0 5-4 7-7 7s-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2"/>', undo: '<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12" transform="translate(0 -2)"/>', redo: '<path d="m16 5 5 5-5 5M21 10H10a6 6 0 0 0 0 12" transform="translate(0 -2)"/>', trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>', copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>', minus: '<path d="M5 12h14"/>', fit: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>', chevron: '<path d="m8 10 4 4 4-4"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', agent: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M9 13h.01M15 13h.01M9 17h6M1 11v5M23 11v5"/>', arrow: '<path d="M3 12h17m-5-5 5 5-5 5"/>', both: '<path d="M3 12h18M8 7l-5 5 5 5m8-10 5 5-5 5"/>', line: '<path d="M3 12h18"/>', dotted: '<path d="M3 12h18" stroke-dasharray="2 4"/>', save: '<path d="M4 3h14l3 3v15H3V3h1M7 3v6h10V3M7 21v-8h10v8"/>', folder: '<path d="M3 20V5h7l2 3h9v12z"/>', spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.plus}</svg>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const colors = ['#ffffff', '#8675ef', '#f3af47', '#4bbda0', '#ed7d9c', '#64a7e5'];
document.querySelector('#app').innerHTML = `
 <header class="topbar"><div class="brand"><img src="assets/icon.svg" alt="">bloom</div><div class="divider"></div><button class="file-button" id="file-toggle" title="File menu" aria-label="File menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><span id="save-status" class="save-status">Recovered locally</span><div class="top-spacer"></div><button class="file-button" data-command="save" title="Download board · Ctrl S" aria-label="Download board">${icon('save')}</button><div class="divider"></div><button class="share-button" id="session-toggle">${icon('agent')}<span>Agent session</span><span class="session-indicator"></span></button></header>
 <main class="board" id="board" aria-label="Brainstorm whiteboard"><svg id="canvas" role="application" aria-label="Interactive brainstorm canvas" tabindex="0"><defs><filter id="bubble-shadow" x="-35%" y="-35%" width="170%" height="180%"><feDropShadow dx="0" dy="7" stdDeviation="9" flood-color="#59647f" flood-opacity=".07"/></filter><marker id="arrow-end" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="m2 2 6 3-6 3" fill="none" stroke="#aeb5c5" stroke-width="1.4"/></marker></defs><g id="world"><g id="edges"></g><g id="nodes"></g></g></svg></main>
 <nav class="toolbar" aria-label="Whiteboard tools"><button class="tool active" data-tool="select" title="Select · V" aria-label="Select tool">${icon('pointer')}</button><button class="tool" data-tool="add" title="Add idea · N" aria-label="Add idea tool">${icon('plus')}</button><button class="tool" data-tool="hand" title="Pan · H or hold Space" aria-label="Pan tool">${icon('hand')}</button><div class="tool-separator"></div><button class="tool" data-command="undo" title="Undo · Ctrl Z" aria-label="Undo">${icon('undo')}</button><button class="tool" data-command="redo" title="Redo · Ctrl Shift Z" aria-label="Redo">${icon('redo')}</button><div class="tool-separator"></div><button class="tool" id="tidy" title="Give overlapping ideas some room" aria-label="Space out ideas">${icon('spark')}</button></nav>
 <div class="bottom-left"><button class="help-button" id="help-toggle" title="How to use Bloom" aria-label="Help">?</button></div><div class="bottom-hint"><b>Double-click</b> to grow an idea <span style="padding:0 12px;color:#ccd0d8">/</span> drag the canvas to wander</div><div class="zoom-bar"><button id="zoom-out" aria-label="Zoom out">${icon('minus')}</button><button class="zoom-value" id="zoom-value" title="Reset zoom">100%</button><button id="zoom-in" aria-label="Zoom in">${icon('plus')}</button><div class="zoom-sep"></div><button id="fit" aria-label="Fit board to view" title="Fit board · F">${icon('fit')}</button></div>
 <div class="selection-actions hidden" id="selection-actions"></div><div id="panels"></div><div id="toast" class="toast hidden" role="status"></div><div id="connector-picker" class="connector-picker hidden"></div><div id="empty" class="empty hidden"></div>`;

const board = document.querySelector('#board'), svg = document.querySelector('#canvas'), world = document.querySelector('#world'), nodesLayer = document.querySelector('#nodes'), edgesLayer = document.querySelector('#edges'), panels = document.querySelector('#panels');
let state, selected = new Set(), selectedEdge = null, tool = 'select', view = { x: innerWidth / 2, y: (innerHeight - 76) / 2 - 25, zoom: 1 }, physical = new Map(), drag = null, pan = null, space = false, editor = null, editTimer, toastTimer, openPanel = null, busy = Promise.resolve(), clipboardCache = null, activeTarget = null, chosenStyle = null, sessionInfo = null, first = true, lastNodeClick = null, consumedDoubleClick = 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const uid = () => crypto.randomUUID();
const nodeById = id => state?.graph?.nodes.find(n => n.id === id);
const clientToWorld = (x, y) => ({ x: (x - view.x) / view.zoom, y: (y - 76 - view.y) / view.zoom });
const worldToClient = (x, y) => ({ x: x * view.zoom + view.x, y: y * view.zoom + view.y + 76 });
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3800); }
function act(name, value) { return api.command(name, value).catch(e => toast(e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''))); }
async function runCommand(name, value) { finishEdit(); await busy; if (!editor) return act(name, value); }
function apply(ops, after, onError) {
  busy = busy.then(async () => { try { update(await api.apply(ops, state.revision)); after?.(); } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); update(await api.getState()); onError?.(); } }); return busy;
}
const generation = n => n.root ? 0 : n.depth ?? 1;
const fontSize = n => Math.max(12, 22 * .91 ** generation(n));
function radius(n) {
  const scale = Math.max(.38, .8 ** generation(n));
  const longest = Math.max(...n.text.split('\n').map(s => s.length));
  const rx = Math.min(155, Math.max(116, longest * 3.4 + 37)) * scale;
  const lines = wrap(n.text || ' ', Math.max(5, Math.floor(rx * 1.6 / (fontSize(n) * .53))));
  return { rx, ry: Math.max(90 * scale, lines.length * fontSize(n) * 1.28 / 1.55) };
}
function wrap(text, width) {
  const out = []; for (const paragraph of text.split('\n')) { let line = ''; for (const word of paragraph.split(' ')) { if ((line + ' ' + word).trim().length > width && line) { out.push(line); line = ''; } while (word.length > width && !line) { break; } line += (line ? ' ' : '') + word; } out.push(line || ' '); }
  return out.slice(0, 5).map((s, i) => s.length > width + 3 ? s.slice(0, width) + '…' : i === 4 && out.length > 5 ? s.slice(0, width - 1) + '…' : s);
}
function update(next) {
  const oldIds = new Set(state?.graph?.nodes.map(n => n.id) ?? []); const changedBoard = state && (state.graph?.nodes[0]?.id !== next.graph?.nodes[0]?.id);
  state = next;
  selected = new Set([...selected].filter(id => nodeById(id))); if (selectedEdge && !state.graph?.edges.some(e => e.id === selectedEdge)) selectedEdge = null;
  if (editor && !nodeById(editor.id)) { editor.el.remove(); editor = null; }
  document.querySelector('#save-status').textContent = state.graph ? state.dirty ? 'Saving changes…' : 'All changes saved' : 'Open a board to begin';
  document.querySelector('[data-command="undo"]').disabled = !state.canUndo; document.querySelector('[data-command="redo"]').disabled = !state.canRedo;
  document.querySelector('#empty').classList.toggle('hidden', !!state.graph);
  if (!state.graph) document.querySelector('#empty').innerHTML = `<img src="assets/icon.svg" alt=""><h1>A little room for ideas.</h1><p>Start a new board or pick up where you left off.</p><button class="primary-button" data-command="new">New brainstorm</button><button class="subtle-button" data-command="open">Open a board…</button>${state.recent.slice(0, 3).map(p => `<button class="recent-open" data-recent="${esc(p)}">${esc(state.boardList?.find(b => b.id === p)?.title || p)}</button>`).join('')}`;
  if (state.graph) for (const n of state.graph.nodes) {
    if (!physical.has(n.id)) { const edge = state.graph.edges.find(e => e.target === n.id); const parent = edge && physical.get(edge.source); physical.set(n.id, { x: parent && !first ? parent.x : n.x, y: parent && !first ? parent.y : n.y, vx: 0, vy: 0, wobble: oldIds.has(n.id) ? 0 : 1, seed: n.id.charCodeAt(0), born: first ? 0 : performance.now() }); }
  }
  for (const id of physical.keys()) if (!nodeById(id)) physical.delete(id);
  renderGraph(); renderSelection();
  if (changedBoard || first) { selected.clear(); fit(); first = false; }
  if (openPanel === 'session') renderSession();
}
function renderGraph() {
  if (!state.graph) { nodesLayer.innerHTML = ''; edgesLayer.innerHTML = ''; return; }
  nodesLayer.innerHTML = state.graph.nodes.map(n => {
    const r = radius(n), font = fontSize(n), lines = wrap(n.text || ' ', Math.max(5, Math.floor(r.rx * 1.6 / (font * .53)))), p = physical.get(n.id);
    return `<g class="bubble${n.root ? ' root' : ''}${selected.has(n.id) ? ' selected' : ''}" transform="translate(${p.x},${p.y})" data-node="${esc(n.id)}" role="button" tabindex="0" aria-label="${esc(n.text || 'Empty idea')}"><path class="selection-ring" d="${blob(r.rx, r.ry, 0, 0, p.seed, 7)}"/><path class="bubble-shape" d="${blob(r.rx, r.ry, 0, 0, p.seed)}" fill="${n.color}"/><text style="font-size:${font}px" ${editor?.id === n.id ? 'visibility="hidden"' : ''}>${lines.map((line, i) => `<tspan x="0" y="${(i - (lines.length - 1) / 2) * font * 1.28 + font * .32}">${esc(line)}</tspan>`).join('')}</text></g>`;
  }).join('');
  edgesLayer.innerHTML = state.graph.edges.map(e => `<path class="edge${selectedEdge === e.id ? ' selected' : ''}" data-edge="${esc(e.id)}" ${e.type === 'dotted' ? 'stroke-dasharray="3 7" stroke-linecap="round"' : ''} ${['arrow', 'both'].includes(e.type) ? 'marker-end="url(#arrow-end)"' : ''} ${e.type === 'both' ? 'marker-start="url(#arrow-end)"' : ''}/>`).join('');
}
function blob(rx, ry, t, wobble, seed, extra = 0, shape = null, grab = null) {
  const points = Array.from({ length: 24 }, (_, i) => { const a = i / 24 * Math.PI * 2; const wave = 1 + Math.sin(a * 3 + seed) * .014 + Math.sin(a * 4 + t * 13) * wobble * .035; const x = Math.cos(a) * (rx + extra) * wave, y = Math.sin(a) * (ry + extra) * wave; return shape ? deformPoint(x, y, rx + extra, ry + extra, shape, grab) : { x, y }; });
  let d = ''; for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; if (!i) { const prev = points[points.length - 1]; d = `M${(prev.x + p.x) / 2},${(prev.y + p.y) / 2}`; } d += ` Q${p.x},${p.y} ${(p.x + q.x) / 2},${(p.y + q.y) / 2}`; } return d + ' Z';
}
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(2, (now - lastFrame) / 16.667); lastFrame = now;
  if (state?.graph) {
    for (const n of state.graph.nodes) {
      const p = physical.get(n.id); if (!p) continue;
      p.shape ??= createDeformation(p.x, p.y);
      if (!drag?.group.some(item => item.id === n.id)) {
        if (reduced) { p.x = n.x; p.y = n.y; }
        else { p.vx += (n.x - p.x) * .055 * dt; p.vy += (n.y - p.y) * .055 * dt; p.vx *= Math.pow(.76, dt); p.vy *= Math.pow(.76, dt); p.x += p.vx * dt; p.y += p.vy * dt; }
      }
      p.wobble *= Math.pow(.98, dt); if (p.wobble < .003) p.wobble = 0;
      const el = nodesLayer.querySelector(`[data-node="${CSS.escape(n.id)}"]`); if (!el) continue; const r = radius(n);
      const age = p.born ? now - p.born : 10000;
      if (!reduced && age < 1500) { const growth = 1 - .72 * Math.exp(-age / 160) + Math.sin(age / 100) * .08 * Math.exp(-age / 400); r.rx *= growth; r.ry *= growth; }
      let contact = null;
      if (activeTarget && (n.id === activeTarget || n.id === drag?.id)) {
        const other = physical.get(n.id === activeTarget ? drag.id : activeTarget);
        if (other) { const dx = other.x - p.x, dy = other.y - p.y, distance = Math.hypot(dx, dy) || 1; contact = { x: dx / distance, y: dy / distance, amount: .19 }; }
      }
      if (reduced) p.shape = createDeformation(p.x, p.y); else stepDeformation(p.shape, p.x, p.y, dt / 60, contact);
      const grab = drag?.id === n.id ? drag.grab : null;
      el.setAttribute('transform', `translate(${p.x},${p.y})`); el.querySelector('.bubble-shape').setAttribute('d', blob(r.rx, r.ry, now / 1000, reduced ? 0 : p.wobble, p.seed, 0, p.shape, grab)); el.querySelector('.selection-ring').setAttribute('d', blob(r.rx, r.ry, now / 1000, reduced ? 0 : p.wobble, p.seed, 7, p.shape, grab));
    }
    for (const e of state.graph.edges) {
      const a = physical.get(e.source), b = physical.get(e.target); if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, angle = Math.atan2(dy, dx); const ar = radius(nodeById(e.source)), br = radius(nodeById(e.target));
      const border = r => 1 / Math.sqrt((Math.cos(angle) / r.rx) ** 2 + (Math.sin(angle) / r.ry) ** 2);
      const l1 = border(ar) * .94, l2 = border(br) * .98;
      const x1 = a.x + Math.cos(angle) * l1, y1 = a.y + Math.sin(angle) * l1, x2 = b.x - Math.cos(angle) * l2, y2 = b.y - Math.sin(angle) * l2;
      const el = edgesLayer.querySelector(`[data-edge="${CSS.escape(e.id)}"]`); if (el) el.setAttribute('d', `M${x1},${y1} C${x1 + dx * .24},${y1 + dy * .12} ${x2 - dx * .24},${y2 - dy * .12} ${x2},${y2}`);
    }
    if (editor) positionEditor();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
function setView() { world.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.zoom})`); board.style.backgroundSize = `${24 * view.zoom}px ${24 * view.zoom}px`; board.style.backgroundPosition = `${view.x}px ${view.y}px`; document.querySelector('#zoom-value').textContent = `${Math.round(view.zoom * 100)}%`; api.viewport({ ...view, width: innerWidth, height: innerHeight - 76 }); }
function zoom(factor, x = innerWidth / 2, y = (innerHeight + 76) / 2) { const p = clientToWorld(x, y); view.zoom = Math.max(.18, Math.min(2.5, view.zoom * factor)); view.x = x - p.x * view.zoom; view.y = y - 76 - p.y * view.zoom; setView(); }
function fit() {
  const ns = state?.graph?.nodes; if (!ns?.length) { view = { x: innerWidth / 2, y: (innerHeight - 76) / 2, zoom: 1 }; setView(); return; }
  const minX = Math.min(...ns.map(n => n.x - radius(n).rx)), maxX = Math.max(...ns.map(n => n.x + radius(n).rx)), minY = Math.min(...ns.map(n => n.y - radius(n).ry)), maxY = Math.max(...ns.map(n => n.y + radius(n).ry));
  view.zoom = Math.min(1.05, (innerWidth - 260) / Math.max(1, maxX - minX), (innerHeight - 300) / Math.max(1, maxY - minY)); view.x = innerWidth / 2 - (minX + maxX) / 2 * view.zoom + 10; view.y = (innerHeight - 76) / 2 - (minY + maxY) / 2 * view.zoom - 10; setView();
}
function setTool(value) { tool = value; document.querySelectorAll('[data-tool]').forEach(el => el.classList.toggle('active', el.dataset.tool === tool)); board.classList.toggle('creating', tool === 'add'); }
function select(id, additive = false) { if (!additive) selected.clear(); if (id) { if (additive && selected.has(id)) selected.delete(id); else selected.add(id); } selectedEdge = null; renderGraph(); renderSelection(); }
function renderSelection() {
  const el = document.querySelector('#selection-actions'); el.classList.toggle('hidden', !selected.size && !selectedEdge);
  if (selectedEdge) { el.innerHTML = `<span class="label">Connection</span>${['line', 'arrow', 'both', 'dotted'].map(t => `<button data-edge-style="${t}" title="${t}">${icon(t)}</button>`).join('')}<button class="delete" data-delete aria-label="Delete connection">${icon('trash')}</button>`; return; }
  el.innerHTML = `<span class="label">${selected.size === 1 ? 'Idea' : `${selected.size} ideas`}</span>${colors.map(c => `<button data-color="${c}" title="Set colour ${c}" aria-label="Set colour ${c}"><span class="swatch" style="background:${c}"></span></button>`).join('')}<div class="zoom-sep" style="align-self:center"></div><button data-copy title="Copy selected ideas" aria-label="Copy selected ideas">${icon('copy')}</button><button class="delete" data-delete title="Delete selected ideas" aria-label="Delete selected ideas">${icon('trash')}</button>`;
}
function nudgeLayout(newNode, exclude = new Set()) {
  const moves = []; for (const n of state.graph.nodes) { if (exclude.has(n.id) || n.root) continue; const dx = n.x - newNode.x, dy = n.y - newNode.y, d = Math.hypot(dx, dy); const needed = radius(n).rx + radius(newNode).rx + 28; if (d < needed) { const a = Math.atan2(dy || .1, dx || .1), distance = needed - d; moves.push({ type: 'updateNode', id: n.id, x: n.x + Math.cos(a) * distance, y: n.y + Math.sin(a) * distance }); physical.get(n.id).wobble = 1; } } return moves;
}
function addNode(x, y, parent) {
  if (!state?.graph) return; finishEdit(); const id = uid();
  if (parent) { const n = nodeById(parent), p = physical.get(parent); let angle = Math.atan2(y - p.y, x - p.x); if (Math.hypot(y - p.y, x - p.x) < 8) angle = state.graph.edges.filter(e => e.source === parent).length * 2.39996; x = n.x + Math.cos(angle) * (radius(n).rx + 145); y = n.y + Math.sin(angle) * (radius(n).ry + 145); p.wobble = 1.8; }
  x = Math.max(-99000, Math.min(99000, x)); y = Math.max(-99000, Math.min(99000, y));
  const ops = [{ type: 'addNode', id, text: 'New idea', x, y, ...(parent ? { parent } : {}) }, ...nudgeLayout({ x, y, text: 'New idea', depth: parent ? generation(nodeById(parent)) + 1 : 1 }, new Set(parent ? [parent] : []))];
  apply(ops, () => { select(id); setTimeout(() => startEdit(id, true), reduced ? 0 : 230); }); setTool('select');
}
function startEdit(id, selectAll = false) {
  if (!nodeById(id)) return; finishEdit(); const n = nodeById(id), el = document.createElement('textarea'); el.className = 'node-editor'; el.value = n.text; el.maxLength = 2000; el.setAttribute('aria-label', 'Edit idea'); el.spellcheck = true; document.body.append(el); editor = { id, el, original: n.text }; select(id); positionEditor(); el.focus(); if (selectAll) el.select();
  el.addEventListener('pointerdown', e => e.stopPropagation()); el.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); const p = clientToWorld(e.clientX, e.clientY); finishEdit(); addNode(p.x, p.y, id); });
  el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') finishEdit(false); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(); } }); el.addEventListener('blur', () => finishEdit());
  el.addEventListener('input', () => positionEditor(true));
}
function positionEditor(resize = false) {
  if (!editor) return; const n = nodeById(editor.id), p = physical.get(editor.id); if (!n || !p) return;
  const pos = worldToClient(p.x, p.y), r = radius(n), font = fontSize(n) * view.zoom;
  const width = r.rx * 1.6 * view.zoom;
  Object.assign(editor.el.style, { left: `${pos.x}px`, top: `${pos.y}px`, width: `${width}px`, fontSize: `${font}px`, lineHeight: '1.28' });
  if (resize || editor.width !== width || editor.font !== font || editor.value !== editor.el.value) {
    editor.el.style.height = '0px'; editor.el.style.height = `${Math.max(font * 1.28, editor.el.scrollHeight)}px`;
    editor.width = width; editor.font = font; editor.value = editor.el.value;
  }
}
function finishEdit(commit = true) {
  if (!editor) return; const previous = editor; editor = null; previous.el.remove();
  if (commit && nodeById(previous.id) && previous.el.value !== previous.original) apply([{ type: 'updateNode', id: previous.id, text: previous.el.value, before: { text: previous.original } }], undefined, () => {
    if (editor || !nodeById(previous.id)) return;
    startEdit(previous.id); editor.el.value = previous.el.value;
    toast(`The idea now says “${nodeById(previous.id).text.slice(0, 70)}”. Your draft is still open; Enter replaces it, Esc keeps their edit.`);
  });
  renderGraph();
}

board.addEventListener('dblclick', e => { if (e.button !== 0) return; clearTimeout(editTimer); if (tool === 'hand' || space || performance.now() - consumedDoubleClick < 500) return; e.preventDefault(); const id = e.target.closest('[data-node]')?.dataset.node; if (id) return; const p = clientToWorld(e.clientX, e.clientY); addNode(p.x, p.y); });
board.addEventListener('pointerdown', e => {
  if (![0, 1].includes(e.button) || !state?.graph) return; clearTimeout(editTimer); closePanel(); const id = e.target.closest('[data-node]')?.dataset.node, edge = e.target.closest('[data-edge]')?.dataset.edge;
  if (e.button === 1 || space || tool === 'hand' || (!id && !edge && tool !== 'add')) { finishEdit(); pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; board.setPointerCapture(e.pointerId); board.classList.add('panning'); e.preventDefault(); return; }
  if (tool === 'add') { const p = clientToWorld(e.clientX, e.clientY); addNode(p.x, p.y, id); e.preventDefault(); return; }
  if (edge) { selected.clear(); selectedEdge = edge; renderGraph(); renderSelection(); return; }
  if (id) {
    finishEdit(); const n = nodeById(id), p = physical.get(id); const wasSelected = selected.has(id); if (!wasSelected || e.shiftKey) select(id, e.shiftKey); else { selectedEdge = null; renderSelection(); }
    const hit = clientToWorld(e.clientX, e.clientY), r = radius(n);
    p.wobble = 0;
    drag = { id, grab: { x: (hit.x - p.x) / r.rx, y: (hit.y - p.y) / r.ry }, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, originalX: n.x, originalY: n.y, moved: false, text: !!e.target.closest('text'), pointerId: e.pointerId, group: [...selected].map(id => ({ id, x: nodeById(id).x, y: nodeById(id).y })) };
    board.setPointerCapture(e.pointerId); e.preventDefault();
  }
});
board.addEventListener('pointermove', e => {
  if (pan) { view.x = pan.vx + e.clientX - pan.x; view.y = pan.vy + e.clientY - pan.y; pan.moved ||= Math.hypot(e.clientX - pan.x, e.clientY - pan.y) > 4; setView(); return; }
  if (!drag) return; const dx = (e.clientX - drag.sx) / view.zoom, dy = (e.clientY - drag.sy) / view.zoom;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return; drag.moved = true;
  const p = physical.get(drag.id); if (!p) { drag = null; return; } p.x = drag.ox + dx; p.y = drag.oy + dy;
  if (drag.group.length > 1) for (const other of drag.group) { if (other.id === drag.id) continue; const op = physical.get(other.id); if (op) { op.x = other.x + dx; op.y = other.y + dy; } }
  const point = clientToWorld(e.clientX, e.clientY);
  if (activeTarget) { const tp = physical.get(activeTarget); if (!tp || Math.hypot(point.x - tp.x, point.y - tp.y) > 230 / view.zoom) activeTarget = null; }
  if (!activeTarget && drag.group.length === 1) for (const n of state.graph.nodes) { if (n.id === drag.id) continue; const np = physical.get(n.id), r = radius(n); if (((point.x - np.x) / (r.rx + 20)) ** 2 + ((point.y - np.y) / (r.ry + 20)) ** 2 < 1) { activeTarget = n.id; break; } }
  renderPicker(e.clientX, e.clientY);
});
function renderPicker(x, y) {
  const picker = document.querySelector('#connector-picker'); picker.classList.toggle('hidden', !activeTarget); chosenStyle = null; if (!activeTarget) return;
  const p = physical.get(activeTarget), screen = worldToClient(p.x, p.y); picker.style.left = `${screen.x}px`; picker.style.top = `${screen.y}px`;
  const choices = [{ type: 'line', x: 0, y: -99, label: 'Line' }, { type: 'arrow', x: 136, y: 0, label: 'One way' }, { type: 'both', x: 0, y: 90, label: 'Two way' }, { type: 'dotted', x: -136, y: 0, label: 'Dotted' }];
  for (const c of choices) if (Math.abs(x - screen.x - c.x) < 48 && Math.abs(y - screen.y - c.y) < 28) chosenStyle = c.type;
  picker.innerHTML = choices.map(c => `<div class="connection-choice${chosenStyle === c.type ? ' chosen' : ''}" style="left:${c.x}px;top:${c.y}px" data-connection="${c.type}">${icon(c.type)}${c.label}</div>`).join('') + '<div class="connection-caption">Release on a connection · Esc to cancel</div>';
}
function pointerUp(e) {
  if (pan) { if (!pan.moved) select(null); pan = null; board.classList.remove('panning'); }
  if (drag) {
    const d = drag, target = activeTarget, style = chosenStyle; drag = null;
    if (d.moved && nodeById(d.id)) {
      if (target && style && nodeById(target)) { apply([{ type: 'connect', source: d.id, target, style }]); }
      else if (!target) { const p = physical.get(d.id), dx = p.x - d.ox, dy = p.y - d.oy; apply(d.group.filter(n => nodeById(n.id)).map(n => ({ type: 'updateNode', id: n.id, x: Math.max(-99000, Math.min(99000, n.x + dx)), y: Math.max(-99000, Math.min(99000, n.y + dy)), before: { x: n.x, y: n.y } }))); }
    } else if (!e.shiftKey) {
      const now = performance.now();
      if (lastNodeClick?.id === d.id && now - lastNodeClick.at < 500 && Math.hypot(e.clientX - lastNodeClick.x, e.clientY - lastNodeClick.y) < 10) {
        clearTimeout(editTimer); consumedDoubleClick = now; lastNodeClick = null;
        const point = clientToWorld(e.clientX, e.clientY); addNode(point.x, point.y, d.id);
      } else { lastNodeClick = { id: d.id, at: now, x: e.clientX, y: e.clientY }; if (d.text) editTimer = setTimeout(() => startEdit(d.id), 300); }
    }
  }
  activeTarget = null; chosenStyle = null; document.querySelector('#connector-picker').classList.add('hidden'); if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId);
}
board.addEventListener('pointerup', pointerUp); board.addEventListener('pointercancel', () => { drag = null; pan = null; activeTarget = null; document.querySelector('#connector-picker').classList.add('hidden'); board.classList.remove('panning'); });
board.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
async function copy() {
  if (!selected.size) return; const data = { format: 'bloom-clipboard', nodes: state.graph.nodes.filter(n => selected.has(n.id)), edges: state.graph.edges.filter(e => selected.has(e.source) && selected.has(e.target)) }; clipboardCache = JSON.stringify(data); await act('copyNodes', clipboardCache); toast(`${selected.size} ${selected.size === 1 ? 'idea' : 'ideas'} copied`);
}
async function paste() {
  if (!state.graph) return;
  try { const raw = await api.command('pasteNodes'), data = JSON.parse(raw || clipboardCache || 'null'); if (data?.format !== 'bloom-clipboard' || !Array.isArray(data.nodes) || data.nodes.length > 100) { toast('Copy some ideas first.'); return; }
    const map = new Map(data.nodes.map(n => [n.id, uid()])); const ops = data.nodes.map(n => ({ type: 'addNode', id: map.get(n.id), text: n.text, x: n.x + 55, y: n.y + 55, color: n.color, depth: n.depth ?? 1 }));
    for (const e of data.edges || []) if (map.has(e.source) && map.has(e.target)) ops.push({ type: 'connect', source: map.get(e.source), target: map.get(e.target), style: e.type });
    apply(ops, () => { selected = new Set(map.values()); renderGraph(); renderSelection(); });
  } catch { toast('The clipboard does not contain Bloom ideas.'); }
}
function removeSelection() { if (selectedEdge) apply([{ type: 'deleteEdge', id: selectedEdge }]); else if (selected.size) apply([{ type: 'deleteNodes', ids: [...selected] }]); }
function tidy() {
  if (!state.graph || state.graph.nodes.length < 2) return; const layout = structuredClone(state.graph.nodes);
  for (let k = 0; k < 25; k++) for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) { const a = layout[i], b = layout[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, needed = radius(a).rx + radius(b).rx + 30; if (d < needed) { const angle = dx || dy ? Math.atan2(dy, dx) : (i + j) * 2.39996, push = (needed - d) * .52; if (!a.root) { a.x -= Math.cos(angle) * push; a.y -= Math.sin(angle) * push; } if (!b.root) { b.x += Math.cos(angle) * push; b.y += Math.sin(angle) * push; } } }
  const moves = layout.filter(n => Math.hypot(n.x - nodeById(n.id).x, n.y - nodeById(n.id).y) > 1).map(n => ({ type: 'updateNode', id: n.id, x: n.x, y: n.y })); if (moves.length) { for (const p of physical.values()) p.wobble = .7; apply(moves, fit); } else toast('Everyone has a little breathing room.');
}
function closePanel() { openPanel = null; panels.innerHTML = ''; }
function fileMenu() {
  if (openPanel === 'file') { closePanel(); return; } openPanel = 'file';
  const item = (name, label, shortcut) => `<button class="menu-item" data-command="${name}">${label}<span class="shortcut">${shortcut || ''}</span></button>`;
  panels.innerHTML = `<div class="popover file-menu">${item('new', 'New brainstorm', 'Ctrl N')}${item('open', 'Import board…', 'Ctrl O')}<div class="menu-rule"></div>${item('save', 'Download board', 'Ctrl S')}${item('saveAs', 'Duplicate board')}${item('export', 'Export JSON Canvas…')}<div class="menu-rule"></div><div class="menu-label">Recent boards</div>${state.recent.length ? state.recent.map(p => `<button class="menu-item" data-recent="${esc(p)}"><span class="recent-name">${esc(state.boardList?.find(b => b.id === p)?.title || p)}</span></button>`).join('') : '<div class="menu-item" style="color:#aaa">Your shared boards will appear here</div>'}<div class="menu-rule"></div>${item('close', 'Close board', 'Ctrl W')}</div>`;
}
async function showSession() { if (openPanel === 'session') { closePanel(); return; } sessionInfo = await api.session(); openPanel = 'session'; renderSession(); }
function renderSession() {
  if (!sessionInfo) return; const last = state.agentActivity;
  panels.innerHTML = `<section class="popover session-panel" aria-label="Agent session"><div class="panel-heading">Think together<button data-close-panel aria-label="Close panel">${icon('close')}</button></div><div class="session-status"><span class="session-indicator${sessionInfo.enabled ? ' active' : ''}"></span>${sessionInfo.enabled ? 'Remote agent access enabled' : 'Agent access paused'}</div><p>Connect your agent to this shared board. Its edits appear for everyone. Board snapshots update while a browser is open.</p><div class="endpoint">${esc(sessionInfo.url || 'Starting session…')}</div><button class="primary-button" id="copy-session">${icon('copy')}Copy MCP connection</button><button class="subtle-button" id="copy-hermes">Copy Hermes configuration</button><button class="subtle-button" id="copy-agent-token">Copy agent token</button><button class="subtle-button" id="rotate-session">Replace token (disconnects old clients)</button><button class="subtle-button" id="revoke-session">Revoke agent token</button><button class="subtle-button" id="pause-session">${sessionInfo.enabled ? 'Pause agent access' : 'Resume agent access'}</button><div class="activity-title">Activity</div>${last ? `<div class="activity-item">Agent<span>${esc(last.message)}</span></div>` : '<p style="font-size:11px;margin-bottom:7px">No agent activity yet. Copy the connection into your agent’s MCP settings. Hermes connects directly with its board token. No plugin or skill is required.</p>'}${state.activity.slice(-4).reverse().map(a => `<div class="activity-item">${esc(a.actor)}<span>${esc(a.message)}</span></div>`).join('')}</section>`;
}
function showHelp() { if (openPanel === 'help') { closePanel(); return; } openPanel = 'help'; panels.innerHTML = `<section class="popover help-panel"><div class="panel-heading">Follow a thought<button data-close-panel aria-label="Close help">${icon('close')}</button></div><p>Every bubble is an idea. Grow a branch, move it around, see where it takes you.</p>${[['New idea', 'Double-click canvas'], ['Grow a branch', 'Double-click a bubble'], ['Edit idea', 'Click text · Enter to finish'], ['New line', 'Shift Enter'], ['Move idea', 'Drag bubble body'], ['Connect ideas', 'Drag onto another bubble'], ['Select several', 'Shift-click'], ['Pan canvas', 'Drag space · middle drag'], ['Zoom', 'Scroll · + / −'], ['Fit everything', 'F'], ['Copy / paste', 'Ctrl C / V'], ['Undo / redo', 'Ctrl Z / Shift Z'], ['Delete selection', 'Delete · Backspace']].map(([a, b]) => `<div class="shortcut-row"><strong>${a}</strong><span>${b}</span></div>`).join('')}</section>`; }
document.addEventListener('click', async e => {
  const button = e.target.closest('button'); if (!button) return;
  if (button.dataset.command) { runCommand(button.dataset.command); closePanel(); }
  if (button.dataset.recent) { runCommand('recent', button.dataset.recent); closePanel(); }
  if (button.dataset.tool) setTool(button.dataset.tool);
  if (button.dataset.color && selected.size) apply([...selected].map(id => ({ type: 'updateNode', id, color: button.dataset.color })));
  if (button.hasAttribute('data-copy')) copy();
  if (button.hasAttribute('data-delete')) removeSelection();
  if (button.hasAttribute('data-close-panel')) closePanel();
  if (button.dataset.edgeStyle && selectedEdge) { const edge = state.graph.edges.find(e => e.id === selectedEdge); apply([{ type: 'connect', source: edge.source, target: edge.target, style: button.dataset.edgeStyle }]); }
  const actions = { 'file-toggle': fileMenu, 'session-toggle': showSession, 'help-toggle': showHelp, 'zoom-in': () => zoom(1.15), 'zoom-out': () => zoom(1 / 1.15), 'zoom-value': () => zoom(1 / view.zoom), fit, tidy, 'copy-session': async () => { await act('copySession'); toast('MCP connection copied.'); }, 'copy-hermes': async () => { await act('copyHermes'); toast('Hermes YAML copied. Put your token in BLOOM_TOKEN on the Hermes machine.'); }, 'copy-agent-token': async () => { await act('copyAgentToken'); toast('Secret token copied. Keep it in Hermes environment settings.'); }, 'rotate-session': async () => { sessionInfo = await api.command('rotateSession'); renderSession(); toast('Old token revoked. Copy the new token into your client.'); }, 'revoke-session': async () => { sessionInfo = await api.command('revokeSession'); renderSession(); toast('Agent token revoked.'); }, 'pause-session': async () => { sessionInfo = await api.command('sessionToggle', !sessionInfo.enabled); renderSession(); } };
  actions[button.id]?.();
});
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,[contenteditable]')) return; const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { clearTimeout(editTimer); drag = null; pan = null; activeTarget = null; document.querySelector('#connector-picker').classList.add('hidden'); board.classList.remove('panning'); closePanel(); select(null); setTool('select'); return; }
  if (mod && ['c', 'x', 'v', 'a', 'z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); if (e.key.toLowerCase() === 'c') copy(); if (e.key.toLowerCase() === 'x') void copy().then(removeSelection); if (e.key.toLowerCase() === 'v') paste(); if (e.key.toLowerCase() === 'a' && state.graph) { selected = new Set(state.graph.nodes.map(n => n.id)); renderGraph(); renderSelection(); } if (e.key.toLowerCase() === 'z') act(e.shiftKey ? 'redo' : 'undo'); if (e.key.toLowerCase() === 'y') act('redo'); return; }
  if (mod) return;
  if (e.key === ' ') { e.preventDefault(); space = true; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelection(); }
  if (e.key === '+' || e.key === '=') zoom(1.15); if (e.key === '-') zoom(1 / 1.15);
  if (e.key.toLowerCase() === 'f') fit(); if (e.key.toLowerCase() === 'v') setTool('select'); if (e.key.toLowerCase() === 'h') setTool('hand'); if (e.key.toLowerCase() === 'n') setTool('add');
  if (e.key === 'Enter') { const focused = e.target.closest('[data-node]')?.dataset.node; const id = focused || [...selected][0]; if (id) { e.preventDefault(); startEdit(id, true); } }
  if (e.key === 'Tab' && selected.size === 1 && e.target === svg) { e.preventDefault(); const n = nodeById([...selected][0]); addNode(n.x + 30, n.y + 15, n.id); }
});
document.addEventListener('keyup', e => { if (e.key === ' ') space = false; });
window.addEventListener('blur', () => { space = false; drag = null; pan = null; activeTarget = null; document.querySelector('#connector-picker').classList.add('hidden'); board.classList.remove('panning'); });
window.addEventListener('resize', setView);
api.onState(update); api.onAction(async a => {
  if (a.type === 'error') toast(a.message);
  else if (a.type === 'command') runCommand(a.name);
  else if (a.type === 'flush') { finishEdit(); await busy; api.flushed(a.id, !editor); }
  else if (['undo', 'redo'].includes(a.type)) { if (document.activeElement?.matches('input,textarea')) document.execCommand(a.type); else act(a.type); }
});
api.onAgent(a => { state.agentActivity = a; document.querySelector('#session-toggle .session-indicator').classList.add('active'); if (openPanel === 'session') renderSession(); if (a.message === 'Edited the board') toast('Your agent added a thought to the board.'); });
update(await api.getState()); setView();
