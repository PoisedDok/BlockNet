import type { AnalyzeOptions, GraphResult } from './types.js';

// Orchestrator: detect() → runEdges() → runRisks() → cache.write() → GraphResult
// (docs/architecture/DIRECTORY-TREE.md). Block detection, edge extraction, risk checks, and
// caching land in Tasks 2-5 (docs/planning/TASKS-V1.md); until then this truthfully reports
// zero blocks and zero edges rather than fabricating a result.
export async function analyze(options: AnalyzeOptions): Promise<GraphResult> {
  const start = Date.now();
  void options;

  return {
    blocks: [],
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
