import type { BlockNode, Edge as CoreEdge } from '@blocknet/core';

export type Selection = { type: 'node' | 'edge'; id: string } | null;

/** Mirrors design_handoff_blocknet_extension's relatedSet(): the id set that stays at full
 * opacity while everything else dims — a selected node plus its direct neighbors, or a
 * selected edge's two endpoints. Returns null when nothing is selected (nothing dims). */
export function relatedIds(selection: Selection, edges: CoreEdge[]): Set<string> | null {
  if (!selection) return null;
  if (selection.type === 'edge') {
    const edge = edges.find((e) => e.id === selection.id);
    return edge ? new Set([edge.source, edge.target]) : new Set();
  }
  const related = new Set([selection.id]);
  for (const edge of edges) {
    if (edge.source === selection.id) related.add(edge.target);
    if (edge.target === selection.id) related.add(edge.source);
  }
  return related;
}

/** Number of edges (either direction) touching a block — the "connection-count badge" Task 7
 * adds beyond the design reference (docs/planning/TASKS-V1.md). */
export function connectionCounts(nodes: BlockNode[], edges: CoreEdge[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) counts[node.id] = 0;
  for (const edge of edges) {
    if (edge.source in counts) counts[edge.source]! += 1;
    if (edge.target in counts && edge.target !== edge.source) counts[edge.target]! += 1;
  }
  return counts;
}
