import dagre from 'dagre';
import type { Position } from '../../../src/shared/protocol.js';

// v2.0.1 unified layer model (docs/planning/ROADMAP-V2.md) — a layer mixes folder-aggregate
// items, file-leaf items, and (at most one) doc-stack item in ONE dagre pass, unlike layout.ts
// (blocks only) and file-layout.ts (files only): each item needs its OWN footprint reserved (a
// folder-card renders pills/connection-count, a file-card doesn't, a doc-stack scales between
// the two by file count), so one fixed NODE_WIDTH/HEIGHT for every node — which both of those
// existing functions rely on — isn't sufficient here. Kept as its own function rather than
// widening either existing one: this is a genuinely different sizing rule (per-item, not
// per-graph), not just a superseding generalization.
const FOLDER_WIDTH = 236;
const FOLDER_HEIGHT = 120;
const FILE_WIDTH = 220;
const FILE_HEIGHT = 92;
// A doc-stack of more than 3 files renders folder-block-sized (DocStackCard.css's own
// `data-large` breakpoint) — kept as one shared constant so layout and rendering can never
// silently drift apart on where that threshold sits.
const DOC_STACK_LARGE_THRESHOLD = 3;

// `files` mirrors LayerDocFile[]'s real shape structurally (just the fields this function
// actually reads) rather than importing the core type — this file has zero type dependencies
// by design, same posture as file-layout.ts/layout.ts before it.
type LayoutItem = { id: string; kind: 'file' } | { id: string; kind: 'folder' } | { id: string; kind: 'docstack'; files: unknown[] };
type LayoutEdge = { source: string; target: string };

function sizeFor(item: LayoutItem): [number, number] {
  if (item.kind === 'file') return [FILE_WIDTH, FILE_HEIGHT];
  if (item.kind === 'folder') return [FOLDER_WIDTH, FOLDER_HEIGHT];
  return item.files.length > DOC_STACK_LARGE_THRESHOLD ? [FOLDER_WIDTH, FOLDER_HEIGHT] : [FILE_WIDTH, FILE_HEIGHT];
}

export function layoutLayerItems(items: LayoutItem[], edges: LayoutEdge[]): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(items.map((i) => i.id));
  for (const item of items) {
    const [width, height] = sizeFor(item);
    g.setNode(item.id, { width, height });
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions: Record<string, Position> = {};
  for (const item of items) {
    const laidOut = g.node(item.id);
    const [width, height] = sizeFor(item);
    positions[item.id] = { x: laidOut.x - width / 2, y: laidOut.y - height / 2 };
  }
  return positions;
}
