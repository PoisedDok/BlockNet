import { detectBlocks } from './blocks/detect.js';
import { derivePills } from './blocks/pills.js';
import { aggregateToBlockEdges } from './edges/block-aggregate.js';
import { runDependencyCruise } from './edges/depcruise-runner.js';
import { buildFileGraph } from './edges/file-graph.js';
import { resolveBlock, ROOT_BLOCK_ID } from './edges/resolve-block.js';
import { walkRealFiles } from './file-walk.js';
import { runRiskChecks } from './risks/index.js';
import type { AnalyzeOptions, BlockNode, GraphResult } from './types.js';

// Orchestrator: detect() → runEdges() → runRisks() → cache.write() → GraphResult
// (docs/architecture/DIRECTORY-TREE.md). Caching lands in Task 5 (docs/planning/TASKS-V1.md).
export async function analyze(options: AnalyzeOptions): Promise<GraphResult> {
  const start = Date.now();

  const blocks = detectBlocks(options.rootDir);

  const cruiseResult = await runDependencyCruise(options.rootDir);
  const fileEdges = buildFileGraph(cruiseResult, options.rootDir);

  // `fileCount` (both per-block and meta.fileCount) counts every real file, any language —
  // NOT just what dependency-cruiser scanned. Import/edge analysis stays TS/JS-only
  // (docs/decisions/0004, unchanged), but a block's fileCount is a truth-telling inventory,
  // not a byproduct of which files happen to be importable: a Python/Go/Rust sub-project
  // (docs/decisions/0005's 2026-07-19 amendment widened block *detection* the same way) is
  // still real content, and hiding it behind a TS/JS-only count would contradict the very
  // block it now correctly detects. file-walk.ts applies the identical exclude rules
  // (node_modules, build output, dot-directories) as dependency-cruiser's own module scan, so
  // the two file inventories can't silently disagree about what counts as source.
  const allRealFiles = walkRealFiles(options.rootDir);

  // Tally each block's real file count and detect whether any file falls outside every
  // detected block's path prefix — if so, the synthetic root catch-all (docs/decisions/0005)
  // gets appended below. detect.ts deliberately can't know this itself (it never walks
  // files); this is the first point in the pipeline that does.
  const fileCounts = new Map<string, number>();
  let hasRootFiles = false;
  for (const filePath of allRealFiles) {
    const blockId = resolveBlock(filePath, blocks);
    if (blockId === ROOT_BLOCK_ID) hasRootFiles = true;
    fileCounts.set(blockId, (fileCounts.get(blockId) ?? 0) + 1);
  }

  const allBlocks: BlockNode[] = blocks.map((block) => ({
    ...block,
    fileCount: fileCounts.get(block.id) ?? 0,
  }));
  // A detected block whose real path happens to equal the "(root)" sentinel (an
  // astronomically unlikely but legal directory name) would otherwise get a second,
  // duplicate-id BlockNode pushed below — its own files and the true catch-all's orphan
  // files already share one fileCounts bucket by construction (resolveBlock can't tell them
  // apart once the id collides), so the correct degrade here is "don't duplicate the node,"
  // not "silently drop a file's contribution."
  if (hasRootFiles && !allBlocks.some((block) => block.id === ROOT_BLOCK_ID)) {
    allBlocks.push({
      id: ROOT_BLOCK_ID,
      name: ROOT_BLOCK_ID,
      path: ROOT_BLOCK_ID,
      pills: derivePills(options.rootDir, options.rootDir),
      fileCount: fileCounts.get(ROOT_BLOCK_ID) ?? 0,
      riskCount: 0,
    });
  }

  const blockEdges = aggregateToBlockEdges(fileEdges, allBlocks);

  // Risk checks (docs/decisions/0006) need the full pre-aggregation file-level graph — a
  // cycle or a boundary violation is a fact about specific files, not just which blocks
  // happen to touch (block-aggregate.ts already discarded that granularity, and Edge itself
  // has no evidence array of its own; see risks/index.ts's header comment).
  const { edges, risks } = runRiskChecks(fileEdges, allBlocks, blockEdges, options.rootDir);

  const riskCounts = new Map<string, number>();
  for (const risk of risks) {
    riskCounts.set(risk.source, (riskCounts.get(risk.source) ?? 0) + 1);
    riskCounts.set(risk.target, (riskCounts.get(risk.target) ?? 0) + 1);
  }
  for (const block of allBlocks) {
    block.riskCount = riskCounts.get(block.id) ?? 0;
  }

  return {
    blocks: allBlocks,
    edges,
    risks,
    meta: {
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      fileCount: allRealFiles.length,
      cacheHit: false,
    },
  };
}
