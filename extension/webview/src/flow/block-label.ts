/** Shared accessible-name text for a block card, used both by BlockCard's own standalone
 * interactive semantics and by BlockCanvas.tsx's RF node.ariaLabel (React Flow's node
 * wrapper already owns tabIndex/role/keyboard handling once a node is mounted inside
 * <ReactFlow>, so BlockNode.tsx must not duplicate a second, nested interactive element —
 * see BlockCard's `interactive` prop). */
export function blockAriaLabel(args: { name: string; path: string; riskCount: number; connectionCount: number }): string {
  const { name, path, riskCount, connectionCount } = args;
  const connections = `${connectionCount} connection${connectionCount === 1 ? '' : 's'}`;
  if (riskCount > 0) {
    return `${name}, ${path}, ${riskCount} risk${riskCount === 1 ? '' : 's'}, ${connections}`;
  }
  return `${name}, ${path}, ${connections}`;
}
