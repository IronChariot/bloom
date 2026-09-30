export function revisions(board) {
  // Older deployed writers only advance the global revision: invalidate both safely.
  if (Math.max(board.content_revision ?? -1, board.layout_revision ?? -1) < board.revision) return { revision: board.revision, contentRevision: board.revision, layoutRevision: board.revision };
  return { revision: board.revision, contentRevision: board.content_revision ?? board.revision, layoutRevision: board.layout_revision ?? board.revision };
}

export function revisionChanges(before, after) {
  const content = graph => ({ ...graph, nodes: graph.nodes.map(({ x, y, ...node }) => node) });
  const layout = graph => graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
  return { content: JSON.stringify(content(before)) !== JSON.stringify(content(after)), layout: JSON.stringify(layout(before)) !== JSON.stringify(layout(after)) };
}

// A rebased edit names the revision it was made against; the operations themselves carry
// what must still hold (text and comment before-values, edit locks), so the board may have moved on.
export const rebases = input => input.baseRevision !== undefined && !input.action;

export function checkRevision(board, input) {
  const split = input.expectedContentRevision !== undefined || input.expectedLayoutRevision !== undefined;
  if (rebases(input)) {
    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0 || input.baseRevision > board.revision) throw new Error('baseRevision must be a board revision you have read.');
    if (!split && input.expectedRevision === undefined) return;
  }
  // Undo and redo touch only the person's own changes, and only where nobody has changed them since.
  if ((input.action === 'undo' || input.action === 'redo') && input.expectedRevision === undefined) return;
  if (!split || input.action) {
    if (input.expectedRevision !== board.revision) throw new Error('The board changed. Read it again before retrying.');
    return;
  }
  const ops = input.operations || [];
  const content = ops.some(op => op.type !== 'updateNode' || op.text !== undefined || op.color !== undefined || op.size !== undefined || op.depth !== undefined);
  const layout = ops.some(op => ['updateNode', 'addNode'].includes(op.type) && (op.x !== undefined || op.y !== undefined));
  const current = revisions(board);
  if (content && input.expectedContentRevision !== current.contentRevision) throw new Error('Board content changed. Read it again before retrying.');
  if (layout && input.expectedLayoutRevision !== current.layoutRevision) throw new Error('Board layout changed. Read it again before retrying.');
  // Even explicitly supplied extra preconditions must be honoured.
  if (input.expectedContentRevision !== undefined && input.expectedContentRevision !== current.contentRevision) throw new Error('Board content changed. Read it again before retrying.');
  if (input.expectedLayoutRevision !== undefined && input.expectedLayoutRevision !== current.layoutRevision) throw new Error('Board layout changed. Read it again before retrying.');
}
