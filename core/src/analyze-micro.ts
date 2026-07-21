// v2.0 micro view (docs/planning/ROADMAP-V2.md): a single block's file-level graph, computed
// entirely from the LAST macro analyze() run's cache — never a fresh dependency-cruiser cruise.
// This is what keeps a block double-click cheap: cache/store.ts already persists the
// pre-aggregation FileEdge[] a macro run built (docs/architecture/STATE-OWNERSHIP.md), so this
// only needs a bounded directory walk (one block's own files) + real LOC reads + re-running
// Tarjan over the already-cached edge list (risks/cycles.ts's own header comment: "O(V+E) pass
// cheap enough that scoping buys nothing" — already validated at Checkpoint-A scale for the
// full graph; re-running it here, on a rare user-driven double-click rather than every save,
// is the same proven-cheap cost paid far less often).
//
// Deliberately reuses risks/cycles.ts's findCyclicFileEdges() UNFILTERED — runRiskChecks()
// (risks/index.ts) filters cyclic file edges down to only the CROSSING portion for the macro
// graph's block-level Risk[], explicitly leaving intra-block cyclic edges undetected there
// ("a whole-cycle-within-one-block finding is file/micro-view territory" — that file's own
// header comment). This is exactly that territory: a file card gets `risk: true` if it
// participates in an intra-block cycle, or if it's the source file of an existing
// cross-block Risk whose `source` is this block (Risk.evidence.file is always a real,
// already-validated file in the risk's source block — see risks/index.ts's toEvidence()).
//
// Known, accepted scoping nuance (two-pass review's architectural-soundness lane, checked and
// not fixed — a real gap in framing, not in the computation): the SCC computation itself is
// correct (whole-graph Tarjan, exactly like risks/cycles.ts's own macro-scale use), but a
// block's intra-block edge can be flagged risky because it's part of a LARGER strongly-
// connected component that also spans an external block never shown in this view — e.g.
// A→B→C→A where A and C are in the requested block but B (the file that actually completes
// the cycle) belongs to a different block and never appears here. The flag is numerically
// correct (the edge genuinely is part of a real cycle) but can read as "this cycle is fully
// contained in this block," which it may not be. Not fixed here: doing so would mean either
// suppressing a true finding or fetching cross-block context this view doesn't otherwise need
// — a real design question for a future micro-view iteration, not a silent truth gap today.
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readCache } from './cache/store.js';
import { resolveBlock } from './edges/resolve-block.js';
import { walkRealFiles } from './file-walk.js';
import { findCyclicFileEdges } from './risks/cycles.js';
import type { BlockNode, FileEdge, MicroFileEdge, MicroFileNode, MicroGraphResult } from './types.js';

export type AnalyzeMicroOptions = { rootDir: string; cacheDir: string; blockId: string };

// A LOC count only ever needs to read real source-sized text. Anything bigger than this never
// needs a full read — found via real-repo verification (a 528MB tar.gz checked into a real
// repo's root made that block's micro request take 2-3s, fully UTF-8-decoding the whole blob
// and splitting it, once per double-click). No real TS/JS source file this project analyzes
// approaches this size; a file that does is either a vendored/binary artifact (this project's
// file-walk is generic multi-language, so it walks these too) or a pathological outlier either
// way not worth a full read for a LOC badge.
//
// Checked and accepted, not fixed: `loc: 0` is now an overloaded sentinel — a deleted/
// unreadable file, a file over MAX_LOC_SCAN_BYTES, and a genuinely empty file are all
// indistinguishable to a caller. Searched all three Checkpoint-A-style real repos used to
// validate this module for a legitimate committed source/generated file over 2MB outside an
// already-excluded directory (dist/build/.next/etc.) — found none, so this hasn't manifested
// as a real misleading "0 LOC" card yet. A future micro-view iteration surfacing a distinct
// "too large to scan" state to the webview would close this gap; not done here since it's
// unobserved on real data, not because it's not a real theoretical gap.
const MAX_LOC_SCAN_BYTES = 2 * 1024 * 1024;

function pairKey(source: string, target: string): string {
  return `${source}\0${target}`;
}

function countLines(absPath: string): number {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(absPath);
  } catch {
    // Deleted/renamed between the cached run and this on-demand request — a real race
    // (the same class open-file.ts's showTextDocument catch already handles), not
    // hypothetical. Degrade to 0 rather than drop the file from the card list entirely: the
    // file is still a real, cached graph fact (it has edges), just unreadable right now.
    return 0;
  }
  if (stats.size > MAX_LOC_SCAN_BYTES) return 0;

  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return 0;
  }
  if (content === '') return 0;
  // A trailing newline (the POSIX-conventional last byte of almost every real source file)
  // would otherwise count as one phantom extra empty line — split('\n') on "a\nb\n" yields
  // ['a','b',''], not ['a','b'].
  return (content.endsWith('\n') ? content.slice(0, -1) : content).split('\n').length;
}

/** `block`'s own real files, as rootDir-relative POSIX paths — one whole-tree
 * walkRealFiles(rootDir) call, filtered by resolveBlock(), the EXACT same mechanism
 * analyze.ts's computeBlockShape() uses to produce the authoritative per-block fileCount this
 * function's result must match. Deliberately NOT scoped to walkRealFiles(join(rootDir,
 * block.path)) for a non-root block, even though that would normally be the cheaper walk: two
 * real bugs already came from that shortcut diverging from computeBlockShape()'s semantics.
 * 1) A block's own directory can legitimately contain ANOTHER, more specific detected block
 *    nested inside it (e.g. this repo's own root package.json workspaces: ["core", "extension",
 *    "extension/webview"] — real npm workspaces nest a member's path inside another member's).
 *    A scoped walk with no resolveBlock filter included the nested block's files too — found
 *    via real-repo verification against this exact repo (80 files vs. the authoritative 24).
 * 2) walkRealFiles()'s real-path dedup (file-walk.ts) is scoped to ONE call — computeBlockShape
 *    gets correct cross-block dedup for free because it makes exactly one whole-tree call, but
 *    a SEPARATE per-block scoped call has no visibility into what a different block's own walk
 *    already claimed. A physical file reachable via a symlink in one block's directory but
 *    physically owned by another (real Nx/Bazel-style tooling pattern) would then be listed by
 *    BOTH blocks' scoped walks, even though the shared-dedup fileCount only ever credits it
 *    once. Paying one whole-tree walk per micro request (rather than one scoped to the
 *    requested block) is the deliberate cost of guaranteeing this function can never again
 *    silently diverge from the one authoritative definition of "this block's files." */
function filesForBlock(rootDir: string, block: BlockNode, allBlocks: BlockNode[]): string[] {
  return walkRealFiles(rootDir).filter((file) => resolveBlock(file, allBlocks) === block.id);
}

/** Aggregates same-(source,target) FileEdges into one MicroFileEdge each — dependency-cruiser
 * typically already reports one dependency per unique resolved target, but this doesn't trust
 * that: two separate import statements in the same file resolving to the same target file must
 * still render as one edge, not a duplicate-id collision (the same aggregation shape
 * edges/block-aggregate.ts already establishes at block granularity, applied here at file
 * granularity instead). A resolved self-import (source === target) is dropped, not rendered —
 * a degenerate case with no real architectural meaning, matching layout.ts's own dagre setup,
 * which skips the identical case at block level. */
function aggregateFileEdges(fileEdges: FileEdge[], cyclicKeys: Set<string>): MicroFileEdge[] {
  const bySourceTarget = new Map<string, MicroFileEdge>();
  for (const edge of fileEdges) {
    if (edge.sourceFile === edge.targetFile) continue;
    const key = pairKey(edge.sourceFile, edge.targetFile);
    if (bySourceTarget.has(key)) continue;
    bySourceTarget.set(key, {
      id: `${edge.sourceFile}->${edge.targetFile}`,
      source: edge.sourceFile,
      target: edge.targetFile,
      risk: cyclicKeys.has(key),
    });
  }
  return [...bySourceTarget.values()];
}

/** Returns `undefined` when there's nothing to compute from — no cache on disk yet (cacheDir
 * write failed, or somehow called before any macro run ever completed) or `blockId` doesn't
 * match any block in the cached snapshot (a stale request for a block a newer analysis run has
 * since removed). Both degrade to "no micro data available" for the caller to surface as a
 * friendly refresh prompt, never a crash — same convention as cache/store.ts's own readCache(). */
export async function analyzeMicroBlock(options: AnalyzeMicroOptions): Promise<MicroGraphResult | undefined> {
  const cached = readCache(options.cacheDir);
  if (!cached) return undefined;

  const { blocks, risks } = cached.snapshot;
  const block = blocks.find((b) => b.id === options.blockId);
  if (!block) return undefined;

  const filePaths = filesForBlock(options.rootDir, block, blocks);

  const intraBlockEdges = cached.fileEdges.filter(
    (e) => resolveBlock(e.sourceFile, blocks) === block.id && resolveBlock(e.targetFile, blocks) === block.id,
  );
  const cyclicKeys = new Set(
    findCyclicFileEdges(cached.fileEdges)
      .filter((e) => resolveBlock(e.sourceFile, blocks) === block.id && resolveBlock(e.targetFile, blocks) === block.id)
      .map((e) => pairKey(e.sourceFile, e.targetFile)),
  );

  const riskyFiles = new Set<string>();
  for (const key of cyclicKeys) {
    const [source, target] = key.split('\0') as [string, string];
    riskyFiles.add(source);
    riskyFiles.add(target);
  }
  for (const risk of risks) {
    if (risk.source !== block.id) continue;
    for (const evidence of risk.evidence) riskyFiles.add(evidence.file);
  }

  const files: MicroFileNode[] = filePaths.map((file) => ({
    id: file,
    name: basename(file),
    path: file,
    loc: countLines(join(options.rootDir, file)),
    risk: riskyFiles.has(file),
  }));

  return { blockId: block.id, files, edges: aggregateFileEdges(intraBlockEdges, cyclicKeys) };
}
