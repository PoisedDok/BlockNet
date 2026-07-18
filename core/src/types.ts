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
  // Present → incremental path (cache/invalidate.ts). Absent → full scan.
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
  files: Record<string, { hash: string; blockId: string }>;
};
