import dagre from 'dagre';
import type { BlockNode, Edge } from '@blocknet/core';

// Card footprint used purely for layout spacing — kept in sync by eye with BlockNode.tsx's
// actual rendered size (236px wide per the design tokens; height is an estimate since real
// cards vary with pill-wrap, and dagre needs one fixed box per node either way).
const NODE_WIDTH = 236;
const NODE_HEIGHT = 120;

export type Position = { x: number; y: number };

/** Auto-layout for the macro graph (docs/decisions/0007): left-to-right rank flow so an
 * edge's target lands to the right of its source, matching the output(right)→input(left)
 * port convention. Runs on every hydration for now — Task 8 makes this apply only to
 * BlockNode ids absent from a persisted positions map (docs/architecture/DIRECTORY-TREE.md);
 * with no persistence yet, every node is "new" every time. */
export function layoutBlocks(nodes: BlockNode[], edges: Edge[]): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 140 });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions: Record<string, Position> = {};
  for (const node of nodes) {
    const laidOut = g.node(node.id);
    // dagre positions are center-based; BlockNode.tsx (like the design reference) positions
    // from the card's top-left corner.
    positions[node.id] = { x: laidOut.x - NODE_WIDTH / 2, y: laidOut.y - NODE_HEIGHT / 2 };
  }
  return positions;
}
