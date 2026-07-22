// v2.0.1 unified layer model (docs/planning/ROADMAP-V2.md): one layer's full rendered
// shape — items (folder-aggregates + file-leaves), intra-layer edges, inter-layer arrows —
// computed entirely from the LAST macro analyze() run's cache, never a fresh
// dependency-cruiser cruise. This is the item-listing (layer-items.ts) and edge-resolution
// (layer-connections.ts) halves wired together into one on-demand query, plus card-metadata
// (loc/risk/pills/fileCount) — this module supersedes the old per-block-only analyze-micro.ts
// (deleted; every layer, including a single block's own file list, is a layer now).
//
// Risk scoping is GLOBAL, not block-scoped: a single layer can mix items from several
// different blocks (layer 0 routinely does), so "scope the cycle check to one enclosing
// block" doesn't have a single block to scope to. A file is flagged risky if it genuinely
// participates in ANY real cycle anywhere in the graph, or is named as evidence in ANY Risk.
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readCache } from './cache/store.js';
import { itemsForLayer } from './edges/layer-items.js';
import { resolveLayerConnections } from './edges/layer-connections.js';
import { findCyclicFileEdges } from './risks/cycles.js';
import { walkRealFiles } from './file-walk.js';
import type { LayerFileItem, LayerGraphResult, LayerItem } from './types.js';

export type AnalyzeLayerOptions = { rootDir: string; cacheDir: string; layerPath: string };

// Documentation extensions only — deliberately NOT "zero import edges", since doc files never
// appear in FileEdge[] regardless of any heuristic (dependency-cruiser doesn't parse prose), so
// that signal can't distinguish a doc file from a genuinely isolated real source file (a leaf
// utility, a standalone script with no imports/importers) — see docs/planning/ROADMAP-V2.md's
// v2.0.1 "Why extension-only, not zero import edges" for the full reasoning.
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);

function isDocFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot !== -1 && DOC_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/** Collapses this layer's own doc-extension file items into ONE LayerDocStackItem — real-repo
 * motivated (docs/planning/ROADMAP-V2.md's v2.0.1 doc-stack card): a folder with dozens of
 * small one-concept docs would otherwise render as a long vertical pile of near-identical
 * file-leaf-cards. A SINGLE loose doc file stays an ordinary file-leaf item — the stack only
 * replaces what would otherwise be a real pile, matching that doc's own "more than one" rule.
 * `id` is derived from `layerPath` itself, not the file set, so a user's drag persists across a
 * save that adds/removes a doc file — exactly one doc-stack can ever exist per layer by
 * construction.
 *
 * Checked and accepted, not proven impossible: this assumes a real file/folder is never
 * literally named `(docstack)` (the same assumption `ROOT_BLOCK_ID = '(root)'` already makes
 * elsewhere in this codebase, `decisions/0006`). A parenthesized directory name IS a real
 * convention some frameworks use (Next.js route groups) — if AD-5's cascade or a plain loose
 * folder ever legitimately matched this exact synthetic segment, its own boundary id would
 * collide with this one. Not fixed with a guaranteed-uncollidable id (e.g. a NUL-byte marker,
 * this codebase's own established technique for that — `edges/layer-connections.ts`'s
 * `pairKey`) because that would need updating every test asserting today's human-readable
 * `(docstack)` id shape for a real-world collision odds this low; revisit if a real repo ever
 * actually hits it. */
function groupDocFiles(items: LayerItem[], layerPath: string): LayerItem[] {
  const docItems = items.filter((item): item is LayerFileItem => item.kind === 'file' && isDocFile(item.path));
  if (docItems.length <= 1) return items;

  const docIds = new Set(docItems.map((item) => item.id));
  const rest = items.filter((item) => !docIds.has(item.id));
  return [
    ...rest,
    {
      kind: 'docstack',
      id: layerPath === '' ? '(docstack)' : `${layerPath}/(docstack)`,
      files: docItems.map((item) => ({ path: item.path, name: item.name })),
    },
  ];
}

// A LOC count only ever needs to read real source-sized text — found via real-repo
// verification (a 528MB tar.gz checked into a real repo's root made a layer request take
// 2-3s, fully UTF-8-decoding the whole blob and splitting it). No real TS/JS source file this
// project analyzes approaches this size; a file that does is either a vendored/binary
// artifact or a pathological outlier either way not worth a full read for a LOC badge.
//
// Checked and accepted, not fixed: `loc: 0` is an overloaded sentinel — a deleted/unreadable
// file, a file over MAX_LOC_SCAN_BYTES, and a genuinely empty file are all indistinguishable
// to a caller. Searched every Checkpoint-A-style real repo used to validate this for a
// legitimate committed source/generated file over 2MB outside an already-excluded directory —
// found none, so this hasn't manifested as a real misleading "0 LOC" card yet.
const MAX_LOC_SCAN_BYTES = 2 * 1024 * 1024;

function countLines(absPath: string): number {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(absPath);
  } catch {
    // Deleted/renamed between the cached run and this on-demand request — a real race (the
    // same class open-file.ts's showTextDocument catch already handles), not hypothetical.
    // Degrade to 0 rather than drop the file from the item list entirely: the file is still a
    // real, cached graph fact (it has edges), just unreadable right now.
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

/** Returns `undefined` when there's nothing to compute from — no cache on disk yet, same
 * degrade convention as cache/store.ts's own readCache(). Never a crash; the extension host
 * turns this into a friendly refresh prompt. */
export async function analyzeLayer(options: AnalyzeLayerOptions): Promise<LayerGraphResult | undefined> {
  const cached = readCache(options.cacheDir);
  if (!cached) return undefined;

  const { blocks, risks } = cached.snapshot;
  const allFiles = walkRealFiles(options.rootDir);
  const boundaries = itemsForLayer(allFiles, options.layerPath, blocks);

  // One findCyclicFileEdges() pass feeds both riskyFiles (item-level risk: boolean/riskCount)
  // and riskyPairs (edge-level risk, threaded into resolveLayerConnections below) — the same
  // underlying cyclic-edge list, two different shapes callers need it in.
  const riskyFiles = new Set<string>();
  const riskyPairs = new Set<string>();
  for (const edge of findCyclicFileEdges(cached.fileEdges)) {
    riskyFiles.add(edge.sourceFile);
    riskyFiles.add(edge.targetFile);
    riskyPairs.add(`${edge.sourceFile}\0${edge.targetFile}`);
  }
  for (const risk of risks) {
    for (const evidence of risk.evidence) riskyFiles.add(evidence.file);
  }

  const items: LayerItem[] = boundaries.map((boundary): LayerItem => {
    if (!boundary.isFolder) {
      return {
        kind: 'file',
        id: boundary.id,
        name: basename(boundary.path),
        path: boundary.path,
        loc: countLines(join(options.rootDir, boundary.path)),
        risk: riskyFiles.has(boundary.path),
      };
    }

    const matchingBlock = blocks.find((b) => b.id === boundary.id);
    if (matchingBlock) {
      return {
        kind: 'folder',
        id: boundary.id,
        name: basename(boundary.path),
        path: boundary.path,
        isBlock: true,
        pills: matchingBlock.pills,
        fileCount: matchingBlock.fileCount,
        riskCount: matchingBlock.riskCount,
      };
    }

    // A plain (non-block) folder — no authoritative block record to reuse, compute its own
    // subtree fileCount/riskCount directly.
    const subtreeFiles = allFiles.filter((f) => f === boundary.path || f.startsWith(`${boundary.path}/`));
    return {
      kind: 'folder',
      id: boundary.id,
      name: basename(boundary.path),
      path: boundary.path,
      isBlock: false,
      pills: [],
      fileCount: subtreeFiles.length,
      riskCount: subtreeFiles.filter((f) => riskyFiles.has(f)).length,
    };
  });

  const { edges, arrows } = resolveLayerConnections(cached.fileEdges, boundaries, options.layerPath, riskyPairs);

  return { layerPath: options.layerPath, items: groupDocFiles(items, options.layerPath), edges, arrows };
}
