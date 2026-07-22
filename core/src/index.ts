// Public API barrel. The only file an external consumer (or the future v2 webapp) imports —
// docs/architecture/DIRECTORY-TREE.md. One deliberate exception: `isExcludedPath` is exported
// from './path-utils.js' directly (its own package.json "exports" entry), not re-exported
// here, because importing it through this barrel would drag in analyze.ts's whole module
// graph — including dependency-cruiser, which has genuine top-level `await` in some of its
// own source files. That's fine for an ESM-native consumer, but extension/src/watcher.ts is
// bundled into the extension host's CJS entrypoint, and Node cannot `require()` an ESM graph
// containing top-level await (verified: throws ERR_REQUIRE_ASYNC_MODULE) — confirmed
// empirically while wiring Task 6, not a theoretical concern. path-utils.ts itself has zero
// imports, so its own dedicated export stays fully decoupled from that problem.
export { analyze } from './analyze.js';
export { analyzeLayer } from './analyze-layer.js';
export type { AnalyzeLayerOptions } from './analyze-layer.js';
export type {
  AnalysisMeta,
  AnalyzeOptions,
  BlockNode,
  CacheManifest,
  Edge,
  Evidence,
  FileEdge,
  GraphResult,
  LayerArrow,
  LayerDocFile,
  LayerDocStackItem,
  LayerEdge,
  LayerFileItem,
  LayerFolderItem,
  LayerGraphResult,
  LayerItem,
  LayerItemBoundary,
  Progress,
  Risk,
} from './types.js';
// The forked-worker IPC contract (docs/architecture/PROCESS-BOUNDARY.md) — extension/src/
// analysis-runner.ts imports these types from here, never from ipc-worker.ts's own path
// directly, keeping this barrel the one place any consumer imports core's public surface.
export type { LayerWorkerRequest, MacroWorkerRequest, WorkerMessage, WorkerRequest } from './ipc-worker.js';
