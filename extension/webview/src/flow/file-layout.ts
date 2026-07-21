import dagre from 'dagre';
import type { MicroFileEdge, MicroFileNode } from '@blocknet/core';
import type { Position } from '../../../src/shared/protocol.js';

// Auto-layout for the micro (file-level) graph — the same left-to-right dagre approach
// layout.ts uses for blocks (docs/decisions/0007), kept as its own small function rather than
// a shared generic: file cards render smaller than block cards (no pills-derived-from-deps
// row, no connection-count badge), so the footprint dagre needs to reserve per node genuinely
// differs, and there's exactly one caller on each side. This is always the FRESH layout, same
// role layoutBlocks() plays for the macro graph — FileCanvas.tsx layers a persisted/dragged
// override on top of this output (initialPositions?.[id] ?? layoutFiles(...)[id]), the
// identical pattern layout.ts's own comment describes, rather than teaching dagre a pinning
// concept it doesn't have. File positions ARE persisted now (docs/planning/ROADMAP-V2.md's
// file-level drag parity, GraphView.tsx's own camera-store instance + state.ts's
// blocknet.filePositions) — this function itself is unaffected either way, since it never knew
// about persistence in the first place.
const NODE_WIDTH = 220;
const NODE_HEIGHT = 92;

export function layoutFiles(files: MicroFileNode[], edges: MicroFileEdge[]): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(files.map((f) => f.id));
  for (const file of files) {
    g.setNode(file.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions: Record<string, Position> = {};
  for (const file of files) {
    const laidOut = g.node(file.id);
    positions[file.id] = { x: laidOut.x - NODE_WIDTH / 2, y: laidOut.y - NODE_HEIGHT / 2 };
  }
  return positions;
}
