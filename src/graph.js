import { z } from 'zod';
import { randomUUID } from 'node:crypto';

export const palette = ['#8675ef', '#f3af47', '#4bbda0', '#ed7d9c', '#64a7e5', '#dd8460'];
const coord = z.number().finite().min(-100000).max(100000);
const id = z.string().min(1).max(100);
export const nodeSchema = z.object({ id, text: z.string().max(2000), x: coord, y: coord, color: z.string().regex(/^#[0-9a-fA-F]{6}$/), root: z.boolean().optional(), depth: z.number().int().min(0).max(1000).optional() });
export const edgeSchema = z.object({ id, source: id, target: id, type: z.enum(['line', 'arrow', 'reverse', 'both', 'dotted']) });
export const graphSchema = z.object({ format: z.literal('bloom'), version: z.literal(1), title: z.string().min(1).max(200), nodes: z.array(nodeSchema).max(1000), edges: z.array(edgeSchema).max(3000) });
export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addNode'), id: id.optional(), text: z.string().max(2000).optional(), x: coord.optional(), y: coord.optional(), parent: id.optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), depth: z.number().int().min(0).max(1000).optional() }),
  z.object({ type: z.literal('updateNode'), id, text: z.string().max(2000).optional(), x: coord.optional(), y: coord.optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), before: z.object({ text: z.string().max(2000).optional(), x: coord.optional(), y: coord.optional() }).optional() }),
  z.object({ type: z.literal('deleteNodes'), ids: z.array(id).min(1).max(1000) }),
  z.object({ type: z.literal('connect'), source: id, target: id, style: z.enum(['line', 'arrow', 'reverse', 'both', 'dotted']).default('line') }),
  z.object({ type: z.literal('deleteEdge'), id }),
  z.object({ type: z.literal('rename'), title: z.string().min(1).max(200) })
]);

export function mixColors(colors) {
  return '#' + [1, 3, 5].map(i => Math.round(colors.reduce((a, c) => a + parseInt(c.slice(i, i + 2), 16), 0) / colors.length).toString(16).padStart(2, '0')).join('');
}
export function validateGraph(input) {
  const graph = graphSchema.parse(input);
  const ids = new Set(graph.nodes.map(n => n.id));
  if (ids.size !== graph.nodes.length || new Set(graph.edges.map(e => e.id)).size !== graph.edges.length) throw new Error('Duplicate IDs in board.');
  for (const e of graph.edges) if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) throw new Error('Connection refers to missing or identical nodes.');
  // Infer generations only for older files. Later cross-links cannot resize nodes.
  const depths = new Map(graph.nodes.filter(n => n.root || n.depth !== undefined).map(n => [n.id, n.root ? 0 : n.depth]));
  const outgoing = new Map();
  for (const e of graph.edges) { if (!outgoing.has(e.source)) outgoing.set(e.source, []); outgoing.get(e.source).push(e.target); }
  const queue = [...depths.keys()];
  for (let i = 0; i < queue.length; i++) for (const target of outgoing.get(queue[i]) || []) if (!depths.has(target)) { depths.set(target, Math.min(1000, depths.get(queue[i]) + 1)); queue.push(target); }
  for (const n of graph.nodes) n.depth = n.root ? 0 : n.depth ?? depths.get(n.id) ?? 1;
  return graph;
}
export function newGraph(demo = false) {
  const graph = { format: 'bloom', version: 1, title: 'Untitled brainstorm', nodes: [{ id: randomUUID(), text: demo ? 'What could\nwe create?' : 'Your big idea', x: 0, y: 0, color: '#ffffff', root: true }], edges: [] };
  if (demo) {
    const root = graph.nodes[0].id;
    const branches = [['Something\nplayful', -290, -135, palette[0]], ['A shared\nimagination', 270, -150, palette[1]], ['Room to\nexperiment', 10, 245, palette[2]]];
    for (const [text, x, y, color] of branches) {
      const nid = randomUUID(); graph.nodes.push({ id: nid, text, x, y, color }); graph.edges.push({ id: randomUUID(), source: root, target: nid, type: 'line' });
    }
    const leaves = [['Ideas that wobble', -490, -285, 1], ['Humans + AI', 460, -280, 2], ['Happy accidents', 260, 310, 3]];
    for (const [text, x, y, parent] of leaves) {
      const nid = randomUUID(); graph.nodes.push({ id: nid, text, x, y, color: mixColors([graph.nodes[parent].color, graph.nodes[parent].color, '#ffffff']) }); graph.edges.push({ id: randomUUID(), source: graph.nodes[parent].id, target: nid, type: 'line' });
    }
  }
  return validateGraph(graph);
}
export class GraphStore {
  constructor(graph = newGraph(true), onChange = () => {}) { this.graph = validateGraph(graph); this.revision = 0; this.past = []; this.future = []; this.onChange = onChange; this.activity = []; }
  snapshot() { return { graph: structuredClone(this.graph), revision: this.revision, canUndo: !!this.past.length, canRedo: !!this.future.length, activity: this.activity.slice(-12) }; }
  commit(graph, actor, message) {
    this.past.push(structuredClone(this.graph)); if (this.past.length > 100) this.past.shift(); this.future = [];
    this.graph = validateGraph(graph); this.changed(actor, message); return this.snapshot();
  }
  changed(actor, message) {
    this.revision++; this.activity.push({ actor, message, at: Date.now() }); this.activity = this.activity.slice(-50); this.onChange(this.snapshot());
  }
  replace(graph, actor = 'You') { return this.commit(validateGraph(graph), actor, 'Opened a board'); }
  reset(graph) { this.graph = validateGraph(graph); this.past = []; this.future = []; this.changed('You', 'Opened a board'); }
  apply(rawOps, actor = 'You', expectedRevision) {
    if (expectedRevision !== undefined && expectedRevision !== this.revision) throw new Error(`Board changed (revision ${this.revision}). Read it again before retrying.`);
    const ops = z.array(operationSchema).min(1).max(200).parse(rawOps);
    const g = structuredClone(this.graph);
    const find = id => { const n = g.nodes.find(n => n.id === id); if (!n) throw new Error(`Node ${id} does not exist.`); return n; };
    for (const op of ops) {
      if (op.type === 'addNode') {
        const parent = op.parent ? find(op.parent) : null;
        const siblings = parent ? g.edges.filter(e => e.source === parent.id).length : g.nodes.filter(n => !n.root).length;
        const angle = siblings * 2.39996;
        const color = op.color || (parent && !parent.root ? mixColors([parent.color, parent.color, '#ffffff']) : palette[siblings % palette.length]);
        const nid = op.id || randomUUID(); if (g.nodes.some(n => n.id === nid)) throw new Error('Node ID already exists.');
        g.nodes.push({ id: nid, text: op.text ?? 'New idea', x: op.x ?? (parent?.x ?? 0) + Math.cos(angle) * 240, y: op.y ?? (parent?.y ?? 0) + Math.sin(angle) * 240, color, depth: parent ? Math.min(1000, parent.depth + 1) : op.depth ?? 1 });
        if (parent) g.edges.push({ id: randomUUID(), source: parent.id, target: nid, type: 'line' });
      } else if (op.type === 'updateNode') {
        const n = find(op.id);
        for (const [key, value] of Object.entries(op.before || {})) if (n[key] !== value) throw new Error('This idea changed while you were editing. Review the latest version and try again.');
        for (const key of ['text', 'x', 'y', 'color']) if (op[key] !== undefined) n[key] = op[key];
      } else if (op.type === 'deleteNodes') {
        op.ids.forEach(find); g.nodes = g.nodes.filter(n => !op.ids.includes(n.id)); g.edges = g.edges.filter(e => !op.ids.includes(e.source) && !op.ids.includes(e.target));
      } else if (op.type === 'connect') {
        find(op.source); find(op.target); if (op.source === op.target) throw new Error('Choose two different nodes.');
        const existing = g.edges.find(e => e.source === op.source && e.target === op.target);
        if (existing) existing.type = op.style;
        else g.edges.push({ id: randomUUID(), source: op.source, target: op.target, type: op.style });
      } else if (op.type === 'deleteEdge') {
        if (!g.edges.some(e => e.id === op.id)) throw new Error('Connection does not exist.'); g.edges = g.edges.filter(e => e.id !== op.id);
      } else if (op.type === 'rename') g.title = op.title;
    }
    validateGraph(g); return this.commit(g, actor, ops.length === 1 ? ({ addNode: 'Added an idea', updateNode: 'Updated an idea', deleteNodes: 'Removed ideas', connect: 'Connected ideas', deleteEdge: 'Removed a connection', rename: 'Renamed the board' })[ops[0].type] : `Made ${ops.length} changes`);
  }
  undo() { if (!this.past.length) return this.snapshot(); this.future.push(this.graph); this.graph = this.past.pop(); this.changed('You', 'Undid a change'); return this.snapshot(); }
  redo() { if (!this.future.length) return this.snapshot(); this.past.push(this.graph); this.graph = this.future.pop(); this.changed('You', 'Redid a change'); return this.snapshot(); }
}
export function toCanvas(graph) {
  return { nodes: graph.nodes.map(n => ({ id: n.id, type: 'text', text: n.text, x: Math.round(n.x - 90), y: Math.round(n.y - 55), width: 180, height: 110, color: n.color, bloom: { root: !!n.root, depth: n.depth } })), edges: graph.edges.map(e => ({ id: e.id, fromNode: e.source, toNode: e.target, fromEnd: ['both', 'reverse'].includes(e.type) ? 'arrow' : 'none', toEnd: ['both', 'arrow'].includes(e.type) ? 'arrow' : 'none', bloom: { type: e.type } })) };
}
export function fromCanvas(data, title = 'Imported canvas') {
  data = { nodes: [], edges: [], ...data };
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('Invalid JSON Canvas file.');
  if (data.nodes.some(n => n.type !== 'text')) throw new Error('This version imports text nodes only.');
  const presets = ['#ffffff', '#ed7d9c', '#dd8460', '#f3af47', '#4bbda0', '#64a7e5', '#8675ef'];
  return validateGraph({ format: 'bloom', version: 1, title, nodes: data.nodes.map(n => ({ id: n.id, text: n.text, x: n.x + n.width / 2, y: n.y + n.height / 2, color: /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : presets[Number(n.color)] || '#ffffff', root: n.bloom?.root ?? false, depth: n.bloom?.depth })), edges: data.edges.map(e => ({ id: e.id, source: !e.bloom?.type && e.fromEnd === 'arrow' && e.toEnd === 'none' ? e.toNode : e.fromNode, target: !e.bloom?.type && e.fromEnd === 'arrow' && e.toEnd === 'none' ? e.fromNode : e.toNode, type: e.bloom?.type ?? (e.fromEnd === 'arrow' && e.toEnd !== 'none' ? 'both' : e.toEnd !== 'none' || e.fromEnd === 'arrow' ? 'arrow' : 'line') })) });
}
