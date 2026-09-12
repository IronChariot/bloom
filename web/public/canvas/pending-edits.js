// Keep the server snapshot intact. Pending local fields only affect rendering;
// revisions and preconditions still go to the server for conflict detection.
export const boardKey = state => state?.boardId || state?.graph?.nodes[0]?.id || null;

export function withPendingEdits(confirmed, edits) {
  const local = edits.filter(edit => edit.board === boardKey(confirmed));
  if (!confirmed?.graph || !local.length) return confirmed;
  const patches = new Map();
  for (const edit of local) for (const op of edit.operations) {
    if (op.type !== 'updateNode') continue;
    const patch = patches.get(op.id) || {};
    for (const key of ['x', 'y', 'text', 'color']) if (op[key] !== undefined) patch[key] = op[key];
    patches.set(op.id, patch);
  }
  return { ...confirmed, dirty: true, graph: { ...confirmed.graph,
    nodes: confirmed.graph.nodes.map(node => patches.has(node.id) ? { ...node, ...patches.get(node.id) } : node)
  } };
}
