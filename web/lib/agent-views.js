import { revisions } from './revisions.js';
// Agent responses deliberately omit browser state and layout unless requested.
export function readView(board, { view = 'compact', nodeIds, includeLayout = false } = {}) {
  const graph = JSON.parse(board.graph);
  const ids = nodeIds === undefined ? null : new Set(nodeIds);
  const nodes = ids ? graph.nodes.filter(n => ids.has(n.id)) : graph.nodes;
  const edges = ids ? graph.edges.filter(e => ids.has(e.source) || ids.has(e.target)) : graph.edges;
  const result = {
    boardId: board.id, ...revisions(board),
    graph: {
      ...(view === 'full' ? { format: graph.format, version: graph.version } : {}),
      title: graph.title,
      nodes: nodes.map(n => view === 'full' || includeLayout ? { ...n } : { id: n.id, text: n.text }),
      edges,
    },
  };
  if (ids) {
    const found = new Set(nodes.map(n => n.id));
    result.scope = {
      partial: true, nodeIds: [...ids], missingNodeIds: [...ids].filter(id => !found.has(id)),
      // Incident edges may refer to nodes outside this selection. Do not silently expand it.
      boundaryNodeIds: [...new Set(edges.flatMap(e => [e.source, e.target]).filter(id => !found.has(id)))],
    };
  }
  return result;
}

export function editDelta(boardId, previousRevision, before, after, revision = previousRevision + 1) {
  function diff(oldEntities, newEntities) {
    const old = new Map(oldEntities.map(e => [e.id, e]));
    const current = new Set(newEntities.map(e => e.id));
    return {
      added: newEntities.filter(e => !old.has(e.id)),
      updated: newEntities.filter(e => old.has(e.id) && JSON.stringify(e) !== JSON.stringify(old.get(e.id))),
      removed: oldEntities.filter(e => !current.has(e.id)).map(e => e.id),
    };
  }
  const nodes = diff(before.nodes, after.nodes), edges = diff(before.edges, after.edges);
  return {
    boardId, previousRevision, revision,
    added: { nodes: nodes.added, edges: edges.added },
    updated: { nodes: nodes.updated, edges: edges.updated },
    removed: { nodeIds: nodes.removed, edgeIds: edges.removed },
    ...(before.title !== after.title ? { title: after.title } : {}),
  };
}
