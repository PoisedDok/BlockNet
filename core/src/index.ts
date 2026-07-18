// Public API barrel. The only file an external consumer (or the future v2 webapp) imports —
// docs/architecture/DIRECTORY-TREE.md.
export { analyze } from './analyze.js';
export type {
  AnalysisMeta,
  AnalyzeOptions,
  BlockNode,
  CacheManifest,
  Edge,
  Evidence,
  FileEdge,
  GraphResult,
  Progress,
  Risk,
} from './types.js';
