export const HISTORY_LIMIT = 50;
export const HISTORY_BYTES = 8 * 1024 * 1024;

// Keep the nearest undo/redo targets. The arrays are stacks, newest target last.
export function limitHistory(past, future, sizes) {
  const size = () => [...new Set([...past, ...future])].reduce((sum, revision) => sum + (sizes.get(revision) || 0), 0);
  while (past.length + future.length > HISTORY_LIMIT || size() > HISTORY_BYTES) {
    const stack = past.length >= future.length ? past : future;
    if (!stack.length) break;
    stack.shift();
  }
  return { past, future };
}
