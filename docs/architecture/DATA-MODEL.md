# Architecture — Data Model

All thirteen types live in `core/src/types.ts`. `GraphResult` is the payload that crosses the
child-process boundary unmodified (`ipc-worker.ts` → `analysis-runner.ts`). From there, the
extension host splits it across two webview messages, renaming one field to match React
Flow's own vocabulary: `GraphResult.blocks` becomes `graph/macro`'s `nodes`,
`GraphResult.edges` stays `edges`, `GraphResult.risks` becomes the separate `risks/update`
message, and `GraphResult.meta` is not forwarded — it's host-internal (cache-hit bookkeeping
the webview has no use for). `MicroGraphResult` (v2.0 micro view, `docs/planning/
ROADMAP-V2.md`) crosses the same boundary on a separate request/response pair — see
[PROTOCOL.md](./PROTOCOL.md) for both message shapes.

```ts
export type BlockNode = { id: string; name: string; path: string; pills: string[];
                           fileCount: number; riskCount: number };

export type Edge      = { id: string; source: string; target: string;
                           importCount: number; risk?: Risk };

export type Risk      = { tag: 'CIRCULAR' | 'BOUNDARY'; oneLine: string; explain: string;
                           fix: string; source: string; target: string;
                           evidence: Evidence[] };

export type Evidence  = { file: string; line: number; statement: string };

export type FileEdge  = { sourceFile: string; targetFile: string;
                           statement: string; line: number };
                         // edges/file-graph.ts output — pre-aggregation granularity

export type GraphResult = { blocks: BlockNode[]; edges: Edge[]; risks: Risk[];
                             meta: AnalysisMeta };
                         // analyze.ts's return type — emitted by both cli.ts and ipc-worker.ts

export type AnalysisMeta = { analyzedAt: string; durationMs: number;
                              fileCount: number; cacheHit: boolean };

export type AnalyzeOptions = { rootDir: string; cacheDir?: string;
                                changedFiles?: string[];
                                onProgress?: (p: Progress) => void };
                         // changedFiles is reserved for Task 6's watcher integration —
                         // analyze() does not read it yet. Invalidation (Task 5) is entirely
                         // manifest-diff-based: cache/invalidate.ts compares a fresh
                         // CacheManifest against the previous one itself, rather than
                         // trusting a caller-supplied changed-file hint.

export type Progress  = { phase: 'blocks' | 'edges' | 'risks' | 'cache';
                           done: number; total: number };

export type CacheManifest = { version: number; configHash: string;
                               files: Record<string, { hash: string }> };

// v2.0 micro view (docs/planning/ROADMAP-V2.md) — a single block's file-level graph, computed
// on demand by analyze-micro.ts from the LAST macro run's cache, never a fresh dependency-
// cruiser cruise. `id`/`path` are rootDir-relative POSIX paths, the same convention as
// Evidence.file/FileEdge.sourceFile.
export type MicroFileNode = { id: string; name: string; path: string;
                               loc: number; risk: boolean };

export type MicroFileEdge = { id: string; source: string; target: string; risk: boolean };

export type MicroGraphResult = { blockId: string; files: MicroFileNode[];
                                  edges: MicroFileEdge[] };
```

## Field notes

- `Risk.evidence` carries the actual import statement + location so a future connection
  inspector can consume it unchanged — designed forward on purpose, not speculative scope.
- `graph/macro`'s `nodes` are `WebviewBlockNode` (`shared/protocol.ts`: `BlockNode & { dirty:
  boolean }`), not this file's `BlockNode` directly — dirty-file state is an extension-host-only
  concern (`STATE-OWNERSHIP.md`, Task 9) computed fresh from the git API on every push, never
  something core emits or knows about. This is a protocol-layer augmentation, not a change to
  core's frozen Checkpoint-B schema — see `PROTOCOL.md`.
- `AnalysisMeta.cacheHit` is what lets the webview distinguish "cold scan just finished" from
  "warm reload" without a separate message type.
- `CacheManifest.configHash` is the single field `cache/invalidate.ts` checks to decide
  full-bust vs. incremental — see
  [decisions/0008](../decisions/0008-caching-incremental-invalidation.md). `CacheManifest`
  is an internal `core/cache` file format, not part of the frozen `graph.json` surface the
  extension/webview consume.
- `MicroFileNode.risk`/`MicroFileEdge.risk` are booleans, not a full `Risk` object — deliberately
  narrower than `Edge.risk`. A file/intra-block-edge is flagged `risk: true` when it participates
  in an intra-block import cycle (`risks/cycles.ts`'s `findCyclicFileEdges` re-run, unfiltered,
  by `analyze-micro.ts` — `risks/index.ts` itself only ever keeps the CROSSING portion of a cycle
  for the macro graph, deliberately leaving this territory for the micro view) or is the source
  file of an existing cross-block `Risk` whose `source` is this block (`Risk.evidence[].file` is
  always a real, already-validated file in the risk's source block). Never fabricated, never
  re-deriving which specific file on the *target* side of a `BOUNDARY` risk was hit — `Evidence`
  has no `targetFile` field, so that direction stays block-level only until a future layer
  (`ROADMAP-V2.md`'s v2.1 connection inspector) needs it and extends `Evidence` deliberately.
  **Known, accepted scoping nuance:** an intra-block file/edge can be flagged `risk: true`
  because it's part of a LARGER strongly-connected component that also spans a block never
  shown in the micro view (e.g. `A→B→C→A` where `A`/`C` are in the requested block but `B` —
  the file that actually completes the cycle — belongs elsewhere). The flag is numerically
  correct (a real cycle) but can read as "fully contained here," which it may not be — see
  `analyze-micro.ts`'s own header comment.
- `graph/micro`'s `files` are `WebviewMicroFileNode` (`shared/protocol.ts`: `MicroFileNode &
  { dirty: boolean }`), the same protocol-layer-augmentation pattern as `WebviewBlockNode` —
  dirty-file state is extension-host-only and never something `MicroGraphResult` itself carries.
- **`MicroFileNode.loc` is an overloaded sentinel — `0` means "empty file," "deleted/unreadable
  between the cached run and this request," and "over the 2MB LOC-scan cap" all alike**
  (`analyze-micro.ts`'s `countLines()`), with no field distinguishing them. Checked and
  accepted, not fixed: no real repo used to validate this module (the Checkpoint-A-style set —
  see `PROGRESS.md`) has a legitimate committed source/generated file over 2MB outside an
  already-excluded directory, so this hasn't produced a misleading "0 LOC" card on real data
  yet. A future micro-view iteration surfacing a distinct "too large to scan" state would close
  this gap.
