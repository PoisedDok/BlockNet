// See docs/architecture/DATA-MODEL.md — this file is the literal source of that doc.

export type BlockNode = {
  id: string;
  name: string;
  path: string;
  pills: string[];
  fileCount: number;
  riskCount: number;
};

export type Edge = {
  id: string;
  source: string;
  target: string;
  importCount: number;
  risk?: Risk;
};

export type Risk = {
  tag: 'CIRCULAR' | 'BOUNDARY';
  oneLine: string;
  explain: string;
  fix: string;
  source: string;
  target: string;
  evidence: Evidence[];
};

export type Evidence = {
  file: string;
  line: number;
  statement: string;
};

// edges/file-graph.ts output — pre-aggregation granularity.
export type FileEdge = {
  sourceFile: string;
  targetFile: string;
  statement: string;
  line: number;
};

// analyze.ts's return type — emitted by both cli.ts and ipc-worker.ts.
export type GraphResult = {
  blocks: BlockNode[];
  edges: Edge[];
  risks: Risk[];
  meta: AnalysisMeta;
};

export type AnalysisMeta = {
  analyzedAt: string;
  durationMs: number;
  fileCount: number;
  cacheHit: boolean;
};

export type AnalyzeOptions = {
  rootDir: string;
  cacheDir?: string;
  // Populated by extension/src/watcher.ts (Task 6, docs/architecture/FLOWS.md's incremental-
  // re-analyze flow) on pure-content-edit triggers — but still NOT read by analyze(). cache/
  // invalidate.ts (Task 5) determines what's dirty itself, by diffing a full CacheManifest
  // built from every file in the tree, rather than trusting a caller-supplied hint — a
  // deliberate choice (docs/decisions/0008: "the manifest ... used to decide what, if
  // anything, is now stale"), not an oversight. Whether a future caller-supplied
  // changedFiles list should ever let analyze() skip hashing the full tree remains an open,
  // unresolved optimization question — Task 6 shipped without deciding it (see
  // docs/planning/PROGRESS.md's Task 6 entry) — not something to guess at without real
  // watcher behavior at scale to validate against.
  changedFiles?: string[];
  onProgress?: (p: Progress) => void;
};

export type Progress = {
  phase: 'blocks' | 'edges' | 'risks' | 'cache';
  done: number;
  total: number;
};

export type CacheManifest = {
  version: number;
  configHash: string;
  files: Record<string, { hash: string }>;
};

// v2.0.1 unified layer model (docs/planning/ROADMAP-V2.md) — every layer, including layer 0,
// mixes folder-aggregate items (a whole subtree, rendered as one card) and file-leaf items (one
// real file). This describes an item's boundary for edge resolution only — the rendered card's
// own shape (pills/fileCount/riskCount/loc) is a separate, later concern.
export type LayerItemBoundary = {
  id: string;
  path: string; // rootDir-relative POSIX path; exact match for a file, prefix match for a folder
  isFolder: boolean;
};

// An edge between two DIFFERENT items both resolved inside the current layer. `risk` mirrors
// MicroFileEdge's own semantic exactly (cyclic participation only, never BOUNDARY — boundary
// risk is file-scoped, not edge-scoped, same as analyze-micro.ts's aggregateFileEdges()): true
// if ANY raw FileEdge aggregated into this one item-pair is part of a real import cycle.
export type LayerEdge = {
  id: string;
  source: string; // LayerItemBoundary.id
  target: string; // LayerItemBoundary.id
  risk: boolean;
};

// A FileEdge whose one endpoint resolves inside the current layer and the other doesn't —
// rendered as a clickable directional arrow, never a routable edge (ROADMAP-V2.md's v2.0.1
// "Inter-layer connections"). `risk` follows the identical aggregation rule as LayerEdge.risk.
export type LayerArrow = {
  id: string;
  sourceItemId: string; // the visible item this arrow originates from
  targetFile: string; // the off-screen file it points toward
  direction: 'up' | 'down';
  risk: boolean;
};

// The rendered card shape for one layer item — the richer counterpart to LayerItemBoundary
// (edge-resolution only). A folder item that corresponds to an AD-5-detected block reuses that
// block's own authoritative pills/fileCount/riskCount directly rather than recomputing them
// (avoids drift from the one already-authoritative source); a plain (non-block) folder computes
// its own subtree fileCount/riskCount, carries no pills (AD-5 never assigned it a category).
export type LayerFileItem = {
  kind: 'file';
  id: string;
  name: string;
  path: string;
  loc: number;
  risk: boolean;
};

export type LayerFolderItem = {
  kind: 'folder';
  id: string;
  name: string;
  path: string;
  isBlock: boolean;
  pills: string[];
  fileCount: number;
  riskCount: number;
};

// A layer's own loose documentation files (docs/planning/ROADMAP-V2.md's v2.0.1 "doc-stack
// card" — real-repo-motivated: this repo's own `docs/` tree has dozens of small one-concept
// files that would otherwise render as a long vertical pile). Collapses every doc-extension
// file that's a DIRECT child of this layer into ONE item — analyze-layer.ts's job, not
// layer-items.ts's: doc files never appear in FileEdge[] regardless (dependency-cruiser
// doesn't parse prose), so this grouping has zero effect on edge resolution and belongs
// entirely in the rendering-shape layer. `id` is derived from the layer path itself (stable
// across re-analyses, since exactly one doc-stack ever exists per layer by construction), not
// from the file set, so a user's drag persists across saves that add/remove a doc file.
export type LayerDocFile = { path: string; name: string };

export type LayerDocStackItem = {
  kind: 'docstack';
  id: string;
  files: LayerDocFile[];
};

export type LayerItem = LayerFileItem | LayerFolderItem | LayerDocStackItem;

export type LayerGraphResult = {
  layerPath: string;
  items: LayerItem[];
  edges: LayerEdge[];
  arrows: LayerArrow[];
};
