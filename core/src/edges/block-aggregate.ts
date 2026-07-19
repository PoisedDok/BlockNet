// Aggregates file-level edges up to block-level Edge[] (docs/architecture/DATA-MODEL.md).
// Only *crossing* file edges become a block Edge — a file edge whose source and target
// resolve to the same block is an internal implementation detail of that block, not an
// architectural relationship between blocks, and is dropped here (docs/planning/
// TASKS-V1.md Task 3: "block edges = aggregation of crossing file edges").
//
// `Edge` (docs/architecture/DATA-MODEL.md) carries no evidence array of its own — each
// FileEdge already carries its own `statement`/`line`, which is the full evidence a future
// risk (Task 4) needs; `Edge.risk` attaches that evidence when a check actually flags the
// pair (docs/architecture/DIRECTORY-TREE.md's risks/index.ts). Re-duplicating it onto every
// Edge here would be dead weight the macro graph never reads (docs/architecture/
// PROTOCOL.md's `graph/macro` message only needs id/source/target/importCount).
import { resolveBlock } from './resolve-block.js';
import type { BlockNode, Edge, FileEdge } from '../types.js';

// Aggregation is keyed on the NUL byte, not the `->` used for the human-readable `Edge.id`:
// a real block path can legally contain the two-character substring "->" (directory names
// allow it), which would otherwise let two genuinely different (source, target) pairs
// collide onto the same string key — e.g. block "a->b" importing "c" and block "a"
// importing "b->c" both stringify to "a->b->c". `\0` can never appear in a POSIX or Windows
// path component, so this key is collision-free by construction, not by low-probability
// argument.
function aggregationKey(source: string, target: string): string {
  return `${source}\0${target}`;
}

export function aggregateToBlockEdges(fileEdges: FileEdge[], blocks: BlockNode[]): Edge[] {
  const counts = new Map<string, { source: string; target: string; importCount: number }>();

  for (const fileEdge of fileEdges) {
    const source = resolveBlock(fileEdge.sourceFile, blocks);
    const target = resolveBlock(fileEdge.targetFile, blocks);
    if (source === target) continue;

    const key = aggregationKey(source, target);
    const existing = counts.get(key);
    if (existing) {
      existing.importCount += 1;
    } else {
      counts.set(key, { source, target, importCount: 1 });
    }
  }

  return [...counts.values()].map((edge) => ({ id: `${edge.source}->${edge.target}`, ...edge }));
}
