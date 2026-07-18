import { detectBlocks } from './blocks/detect.js';
import type { AnalyzeOptions, GraphResult } from './types.js';

// Orchestrator: detect() → runEdges() → runRisks() → cache.write() → GraphResult
// (docs/architecture/DIRECTORY-TREE.md). Edge extraction, risk checks, and caching land in
// Tasks 3-5 (docs/planning/TASKS-V1.md); until then this truthfully reports zero edges
// rather than fabricating a result. `fileCount` stays 0 until Task 3 walks the file graph —
// block detection alone never needs to enumerate every file.
export async function analyze(options: AnalyzeOptions): Promise<GraphResult> {
  const start = Date.now();

  const blocks = detectBlocks(options.rootDir);

  return {
    blocks,
    edges: [],
    risks: [],
    meta: {
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      fileCount: 0,
      cacheHit: false,
    },
  };
}
