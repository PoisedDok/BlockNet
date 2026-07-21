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

// v2.0 micro view (docs/planning/ROADMAP-V2.md) — a single block's file-level graph, computed
// on demand from the cached macro run's fileEdges (analyze-micro.ts), never re-run through
// dependency-cruiser. `id`/`path` are rootDir-relative POSIX paths, the same convention as
// `Evidence.file`/`FileEdge.sourceFile` — the existing `open/file` flow already trusts this
// shape unchanged (extension/src/commands/open-file.ts).
export type MicroFileNode = {
  id: string;
  name: string;
  path: string;
  loc: number;
  risk: boolean;
};

export type MicroFileEdge = {
  id: string;
  source: string;
  target: string;
  risk: boolean;
};

export type MicroGraphResult = {
  blockId: string;
  files: MicroFileNode[];
  edges: MicroFileEdge[];
};
