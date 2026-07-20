import { detectBlocks } from './blocks/detect.js';
import { derivePills } from './blocks/pills.js';
import { buildManifest } from './cache/manifest.js';
import { planInvalidation } from './cache/invalidate.js';
import { readCache, writeCache } from './cache/store.js';
import { aggregateToBlockEdges } from './edges/block-aggregate.js';
import { runDependencyCruise } from './edges/depcruise-runner.js';
import { buildFileGraph } from './edges/file-graph.js';
import { resolveBlock, ROOT_BLOCK_ID } from './edges/resolve-block.js';
import { walkRealFiles } from './file-walk.js';
import { runRiskChecks } from './risks/index.js';
import type { AnalyzeOptions, BlockNode, FileEdge, GraphResult } from './types.js';

/** Aggregates file-level edges to block level, runs both risk checks over them, and tallies
 * each block's riskCount — the tail every analysis path (cold, content-changed delta, or a
 * config/structural full bust) shares identically once it has a `fileEdges`+`allBlocks` pair,
 * whatever route produced them (docs/decisions/0006). Mutates `allBlocks[].riskCount` in
 * place — callers passing a reused (not freshly built) `allBlocks` array must clone it first
 * so a cache hit's own snapshot is never mutated by a later delta call. */
function finalizeRisks(fileEdges: FileEdge[], allBlocks: BlockNode[], rootDir: string) {
  const blockEdges = aggregateToBlockEdges(fileEdges, allBlocks);
  const { edges, risks } = runRiskChecks(fileEdges, allBlocks, blockEdges, rootDir);

  const riskCounts = new Map<string, number>();
  for (const risk of risks) {
    riskCounts.set(risk.source, (riskCounts.get(risk.source) ?? 0) + 1);
    riskCounts.set(risk.target, (riskCounts.get(risk.target) ?? 0) + 1);
  }
  for (const block of allBlocks) {
    block.riskCount = riskCounts.get(block.id) ?? 0;
  }

  return { edges, risks };
}

/** Tallies each block's real file count from a fresh file walk and appends the synthetic
 * "(root)" catch-all if any file matched no detected block (docs/decisions/0005) — the
 * full-scan path's block-shape computation, shared between a genuine cold start and a
 * config/structural cache bust (both need it recomputed; only a pure content edit, which
 * cannot move files between blocks, gets to reuse the previous snapshot's blocks verbatim). */
function computeBlockShape(rootDir: string, blocks: ReturnType<typeof detectBlocks>, allRealFiles: string[]): BlockNode[] {
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
    riskCount: 0,
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
      pills: derivePills(rootDir, rootDir),
      fileCount: fileCounts.get(ROOT_BLOCK_ID) ?? 0,
      riskCount: 0,
    });
  }
  return allBlocks;
}

// Orchestrator: detect() → runEdges() → runRisks() → cache.write() → GraphResult
// (docs/architecture/DIRECTORY-TREE.md).
//
// Caching (docs/decisions/0008, Task 5): `fileCount`/block detection are cheap (directory
// listings + package.json reads, no AST parsing) and always recomputed fresh, cache or not —
// they're needed up front just to build the current CacheManifest for comparison. What the
// cache actually saves is the expensive step: dependency-cruiser's AST-parse + import
// resolution. Five outcomes, checked in this priority order (docs/decisions/0008,
// cache/invalidate.ts's header comment has the full rationale for why this order is
// necessary, not incidental):
//   1. no cacheDir at all → today's plain full scan, unchanged, never cached.
//   2. cold (no valid previous cache) → full scan, write a fresh cache.
//   3. config-changed (any package.json/tsconfig.json content differs anywhere in the tree)
//      → full scan, write a fresh cache. Overrides everything below it.
//   4. structural-changed (a file was added or removed) → full scan, write a fresh cache.
//      Correctly scoping an add/delete would need a reverse-index over every file's
//      unresolved import specifiers this engine doesn't build — falling back to a full
//      rescan is the safe, honest choice, not an unexploited optimization.
//   5. unchanged (every hash matches, same file set) → return the cached GraphResult
//      snapshot verbatim, near-instant, no re-analysis of any kind.
//   6. content-changed (some existing files' own content changed, nothing added/removed,
//      config untouched) → the only case that's actually scoped: re-cruise just the changed
//      files, splice their fresh edges into the cached file-edge graph, recompute risks +
//      block aggregates (cheap, in-memory) over the merged result. Blocks/fileCounts are
//      reused verbatim — a pure content edit cannot move a file between blocks.
// Total phase count for Progress.total (docs/architecture/FLOWS.md's "progress(blocks, 1/4)
// ... (cache, 4/4)" sequence) — fixed at 4, not derived from which phases actually run, since
// every path except the unchanged-cache-hit early return executes all four in this order.
const PROGRESS_PHASE_COUNT = 4;

export async function analyze(options: AnalyzeOptions): Promise<GraphResult> {
  const start = Date.now();

  const blocks = detectBlocks(options.rootDir);

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

  // Building a manifest means hashing every content-relevant file in the tree — real work,
  // not free. Skipping it entirely when there's no cacheDir isn't just symmetry with "never
  // cached": it's the difference between this being a no-op for CLI/CI callers that never
  // pass --cache-dir, versus silently paying the full hashing cost for a manifest nothing
  // will ever read or write.
  const cached = options.cacheDir !== undefined ? readCache(options.cacheDir) : undefined;
  const currentManifest = options.cacheDir !== undefined ? buildManifest(options.rootDir, allRealFiles) : undefined;
  const plan =
    currentManifest !== undefined ? planInvalidation(cached?.manifest, currentManifest) : ({ kind: 'cold' } as const);

  if (plan.kind === 'unchanged' && cached !== undefined) {
    return {
      ...cached.snapshot,
      meta: { ...cached.snapshot.meta, cacheHit: true, durationMs: Date.now() - start, analyzedAt: new Date().toISOString() },
    };
  }

  options.onProgress?.({ phase: 'blocks', done: 1, total: PROGRESS_PHASE_COUNT });

  let fileEdges: FileEdge[];
  let allBlocks: BlockNode[];
  let cacheHit: boolean;

  if (plan.kind === 'content-changed' && cached !== undefined) {
    const modifiedFiles = new Set(plan.modifiedFiles);
    const scopedCruiseResult = await runDependencyCruise(options.rootDir, undefined, plan.modifiedFiles);
    const freshEdges = buildFileGraph(scopedCruiseResult, options.rootDir).filter((edge) =>
      modifiedFiles.has(edge.sourceFile),
    );
    fileEdges = [...cached.fileEdges.filter((edge) => !modifiedFiles.has(edge.sourceFile)), ...freshEdges];
    // Reused verbatim: a pure content edit cannot add/remove a file or move one between
    // blocks, so fileCount/pills/the root catch-all's presence are all still exactly true.
    // Cloned (not the live cached array) so mutating riskCount below can never corrupt the
    // snapshot readCache() will hand back on some future untouched run.
    allBlocks = cached.snapshot.blocks.map((block) => ({ ...block }));
    cacheHit = true;
  } else {
    const cruiseResult = await runDependencyCruise(options.rootDir);
    fileEdges = buildFileGraph(cruiseResult, options.rootDir);
    allBlocks = computeBlockShape(options.rootDir, blocks, allRealFiles);
    cacheHit = false;
  }

  options.onProgress?.({ phase: 'edges', done: 2, total: PROGRESS_PHASE_COUNT });

  // Risk checks (docs/decisions/0006) need the full pre-aggregation file-level graph — a
  // cycle or a boundary violation is a fact about specific files, not just which blocks
  // happen to touch (block-aggregate.ts already discarded that granularity, and Edge itself
  // has no evidence array of its own; see risks/index.ts's header comment).
  const { edges, risks } = finalizeRisks(fileEdges, allBlocks, options.rootDir);

  options.onProgress?.({ phase: 'risks', done: 3, total: PROGRESS_PHASE_COUNT });

  const result: GraphResult = {
    blocks: allBlocks,
    edges,
    risks,
    meta: {
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      fileCount: allRealFiles.length,
      cacheHit,
    },
  };

  if (options.cacheDir !== undefined && currentManifest !== undefined) {
    writeCache(options.cacheDir, currentManifest, result, fileEdges);
  }

  options.onProgress?.({ phase: 'cache', done: 4, total: PROGRESS_PHASE_COUNT });

  return result;
}
