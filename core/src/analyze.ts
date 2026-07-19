import { detectBlocks } from './blocks/detect.js';
import { derivePills } from './blocks/pills.js';
import { aggregateToBlockEdges } from './edges/block-aggregate.js';
import { runDependencyCruise } from './edges/depcruise-runner.js';
import { buildFileGraph } from './edges/file-graph.js';
import { resolveBlock, ROOT_BLOCK_ID } from './edges/resolve-block.js';
import type { AnalyzeOptions, BlockNode, GraphResult } from './types.js';

// Orchestrator: detect() → runEdges() → runRisks() → cache.write() → GraphResult
// (docs/architecture/DIRECTORY-TREE.md). Risk checks and caching land in Tasks 4-5
// (docs/planning/TASKS-V1.md); until then this truthfully reports zero risks rather than
// fabricating a result.
export async function analyze(options: AnalyzeOptions): Promise<GraphResult> {
  const start = Date.now();

  const blocks = detectBlocks(options.rootDir);

  const cruiseResult = await runDependencyCruise(options.rootDir);
  const fileEdges = buildFileGraph(cruiseResult, options.rootDir);

  // Real files only. dependency-cruiser's module list also contains phantom entries that
  // were never actually scanned from disk: a resolution failure (a broken import's target)
  // surfaces as its own `couldNotResolve` module, and a Node core module (`import fs from
  // 'node:fs'`) surfaces as its own `coreModule` module — confirmed by a real-repo run
  // (`aetherinc`) that leaked `path`/`fs`/`url`/etc. into fileCount and the root block's
  // fileCount before this filter existed.
  const realModules = cruiseResult.modules.filter((mod) => !mod.couldNotResolve && !mod.coreModule);

  // Tally each block's real file count and detect whether any file falls outside every
  // detected block's path prefix — if so, the synthetic root catch-all (docs/decisions/0005)
  // gets appended below. detect.ts deliberately can't know this itself (it never walks
  // files); this is the first point in the pipeline that does.
  const fileCounts = new Map<string, number>();
  let hasRootFiles = false;
  for (const mod of realModules) {
    const blockId = resolveBlock(mod.source, blocks);
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

  const edges = aggregateToBlockEdges(fileEdges, allBlocks);

  return {
    blocks: allBlocks,
    edges,
    risks: [],
    meta: {
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      fileCount: realModules.length,
      cacheHit: false,
    },
  };
}
