// Per-person undo. Each committed change is remembered as a small patch: the ideas, connections
// and title it touched, before and after. Undo (or redo) moves only what still looks the way that
// change left it, so it never overwrites work someone else has done since.
export const UNDO_STEPS = 50;
export const MAX_PATCH_BYTES = 1_900_000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = value => value === undefined ? undefined : structuredClone(value);

function changedEntities(before, after) {
  const was = new Map(before.map(e => [e.id, e])), now = new Map(after.map(e => [e.id, e])), changes = [];
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id) ?? null, b = now.get(id) ?? null;
    if (!same(a, b)) changes.push([id, a, b]);
  }
  return changes;
}
export function diffGraphs(before, after) {
  return { title: before.title === after.title ? null : [before.title, after.title], nodes: changedEntities(before.nodes, after.nodes), edges: changedEntities(before.edges, after.edges) };
}
export const emptyPatch = patch => !patch.title && !patch.nodes.length && !patch.edges.length;

// Returns the new graph and how many parts were moved back (applied) or left alone (skipped).
export function applyPatch(graph, patch, direction = 'undo') {
  const g = structuredClone(graph), undo = direction === 'undo';
  let applied = 0, skipped = 0;
  const orient = ([id, before, after]) => undo ? [id, after, before] : [id, before, after];
  // Field by field: only fields still holding what the change set are returned.
  const revertFields = (current, from, to) => {
    for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
      if (key === 'id' || same(from[key], to[key])) continue;
      if (!same(current[key], from[key])) { skipped++; continue; }
      if (to[key] === undefined) delete current[key]; else current[key] = clone(to[key]);
      applied++;
    }
  };
  if (patch.title) {
    const [from, to] = undo ? [patch.title[1], patch.title[0]] : patch.title;
    if (g.title === from) { g.title = to; applied++; } else skipped++;
  }
  const edges = patch.edges.map(orient), nodes = patch.nodes.map(orient);
  // Remove connections first, so an idea this change created can be removed after them.
  for (const [id, from, to] of edges) if (from && !to) {
    const i = g.edges.findIndex(e => e.id === id); if (i < 0) continue;
    if (same(g.edges[i], from)) { g.edges.splice(i, 1); applied++; } else skipped++;
  }
  for (const [id, from, to] of nodes) {
    const i = g.nodes.findIndex(n => n.id === id);
    if (!from && to) { if (i < 0) { g.nodes.push(clone(to)); applied++; } else skipped++; continue; }
    if (from && !to) {
      if (i < 0) continue;
      // Someone edited or connected it since: leave it, rather than lose their work.
      if (same(g.nodes[i], from) && !g.edges.some(e => e.source === id || e.target === id)) { g.nodes.splice(i, 1); applied++; } else skipped++;
      continue;
    }
    if (i < 0) { skipped++; continue; }
    revertFields(g.nodes[i], from, to);
  }
  const exists = id => g.nodes.some(n => n.id === id);
  for (const [id, from, to] of edges) {
    if (from && !to) continue;
    const i = g.edges.findIndex(e => e.id === id);
    if (!from && to) {
      if (i < 0 && exists(to.source) && exists(to.target) && !g.edges.some(e => e.source === to.source && e.target === to.target)) { g.edges.push(clone(to)); applied++; } else skipped++;
      continue;
    }
    if (i < 0) { skipped++; continue; }
    revertFields(g.edges[i], from, to);
  }
  return { graph: g, applied, skipped };
}
