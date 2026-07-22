# Architecture — Data Model

All types live in `core/src/types.ts`. `GraphResult` is the payload that crosses the
child-process boundary unmodified (`ipc-worker.ts` → `analysis-runner.ts`). From there, the
extension host splits it across two webview messages, renaming one field to match React
Flow's own vocabulary: `GraphResult.blocks` becomes `graph/macro`'s `nodes`,
`GraphResult.edges` stays `edges`, `GraphResult.risks` becomes the separate `risks/update`
message, and `GraphResult.meta` is not forwarded — it's host-internal (cache-hit bookkeeping
the webview has no use for). `LayerGraphResult` (the v2.0.1 unified layer model,
`docs/planning/ROADMAP-V2.md`) crosses the same boundary on a separate request/response pair —
see [PROTOCOL.md](./PROTOCOL.md) for both message shapes.

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

// v2.0.1 unified layer model (docs/planning/ROADMAP-V2.md) — every layer, including layer 0
// (today's "macro" view), mixes folder-aggregate items and file-leaf items; there is no
// separate macro/micro data model. LayerItemBoundary describes an item's edge-resolution
// boundary only (edges/layer-connections.ts, edges/layer-items.ts); LayerFileItem/
// LayerFolderItem/LayerDocStackItem are the richer rendered-card shapes analyze-layer.ts
// produces on top of it.
export type LayerItemBoundary = { id: string; path: string; isFolder: boolean };

export type LayerEdge = { id: string; source: string; target: string; risk: boolean };
                         // an edge between two DIFFERENT items both resolved inside the
                         // current layer. `risk` mirrors the old MicroFileEdge.risk semantic
                         // exactly (cyclic participation only, never BOUNDARY) — true if ANY
                         // raw FileEdge aggregated into this item-pair is part of a real cycle.

export type LayerArrow = { id: string; sourceItemId: string; targetFile: string;
                            direction: 'up' | 'down'; risk: boolean };
                         // a FileEdge whose one endpoint resolves inside the current layer and
                         // the other doesn't — a clickable directional arrow, never a routable
                         // edge (ROADMAP-V2.md's "Inter-layer connections"). `risk` follows the
                         // identical aggregation rule as LayerEdge.risk.

export type LayerFileItem = { kind: 'file'; id: string; name: string; path: string;
                               loc: number; risk: boolean };

export type LayerFolderItem = { kind: 'folder'; id: string; name: string; path: string;
                                 isBlock: boolean; pills: string[]; fileCount: number;
                                 riskCount: number };

export type LayerDocFile = { path: string; name: string };

export type LayerDocStackItem = { kind: 'docstack'; id: string; files: LayerDocFile[] };
                         // a layer's own loose documentation files (.md/.mdx/.markdown/.txt/
                         // .rst/.adoc), collapsed into ONE item when MORE THAN ONE exists at
                         // that exact layer — analyze-layer.ts's groupDocFiles(), real-repo
                         // motivated (this repo's own docs/ tree). `id` is derived from the
                         // layer path itself (`(docstack)`, a synthetic segment), not the file
                         // set, so a drag persists across a save that adds/removes a doc file.

export type LayerItem = LayerFileItem | LayerFolderItem | LayerDocStackItem;

export type LayerGraphResult = { layerPath: string; items: LayerItem[]; edges: LayerEdge[];
                                  arrows: LayerArrow[] };
```

## Field notes

- `Risk.evidence` carries the actual import statement + location so a future connection
  inspector can consume it unchanged — designed forward on purpose, not speculative scope.
- `graph/macro`'s `nodes` are `WebviewBlockNode` (`shared/protocol.ts`: `BlockNode & { dirty:
  boolean }`), not this file's `BlockNode` directly — dirty-file state is an extension-host-only
  concern (`STATE-OWNERSHIP.md`, Task 9) computed fresh from the git API on every push, never
  something core emits or knows about. This is a protocol-layer augmentation, not a change to
  core's frozen Checkpoint-B schema — see `PROTOCOL.md`. `graph/macro`'s own payload is no
  longer rendered directly by the webview (v2.0.1) — its arrival is the signal to (re)issue
  `graph/layer/request`, which is what actually populates the mixed block/file/folder view. On a
  cold open this fetches layer 0 (`''`); on a background re-analysis triggered while the user is
  several layers deep, it re-fetches whichever layer is CURRENTLY being viewed
  (`App.tsx`'s `currentLayerPathRef`), not root — see `PROTOCOL.md` and `FLOWS.md`'s flow 2.
- `AnalysisMeta.cacheHit` is what lets the webview distinguish "cold scan just finished" from
  "warm reload" without a separate message type.
- `CacheManifest.configHash` is the single field `cache/invalidate.ts` checks to decide
  full-bust vs. incremental — see
  [decisions/0008](../decisions/0008-caching-incremental-invalidation.md). `CacheManifest`
  is an internal `core/cache` file format, not part of the frozen `graph.json` surface the
  extension/webview consume.
- **Risk scoping for `LayerItem`/`LayerEdge`/`LayerArrow` is GLOBAL, not block-scoped.** A
  single layer can mix items from several different blocks (layer 0 routinely does), so "scope
  the cycle check to the enclosing block" has no single block to scope to — a file/edge/arrow
  is flagged risky if it genuinely participates in ANY real cycle anywhere in the graph, or (for
  a file item specifically) is named as evidence in ANY `Risk`. This is a real, deliberate
  difference from the retired `MicroFileNode`/`MicroFileEdge`'s block-scoped intra-block-cycle
  filter, not an oversight — see `analyze-layer.ts`'s own header comment.
- **`LayerFileItem.loc` is an overloaded sentinel — `0` means "empty file," "deleted/unreadable
  between the cached run and this request," and "over the 2MB LOC-scan cap" all alike**
  (`analyze-layer.ts`'s `countLines()`), with no field distinguishing them. Checked and
  accepted, not fixed: no real repo used to validate this module (the Checkpoint-A-style set —
  see `PROGRESS.md`) has a legitimate committed source/generated file over 2MB outside an
  already-excluded directory, so this hasn't produced a misleading "0 LOC" card on real data
  yet.
- **`LayerFolderItem` reuses a matching block's own authoritative `pills`/`fileCount`/
  `riskCount` directly when `isBlock: true`**, rather than recomputing them — avoids drift from
  the one already-authoritative source (`analyze.ts`'s own block computation). A plain
  (non-block) folder computes its own subtree `fileCount`/`riskCount` directly and carries no
  pills — AD-5 never assigned it a category.
- **A block nested inside another block's own directory never appears at ITS ENCLOSING BLOCK'S
  OWN layer** (a real shape in this repo: `extension/webview` is a registered block nested
  inside `extension`) — it surfaces as one of that ancestor's own direct-child items once you
  drill into it, at whichever layer that turns out to be (not just layer 0 — the rule is
  depth-agnostic and applies to arbitrarily nested chains), mirroring VS Code's own "compact
  folders" convention rather than flattening every block to one layer regardless of real
  nesting (`edges/layer-items.ts`'s `nestedBlockItemsFor`/`hasIntermediateBlock`). The original
  implementation only ever injected nested blocks at `layerPath === ''` — a real bug, found via
  live verification against this repo's own data (diving into `extension` showed no
  `extension/webview` item at all, and the real edge between them rendered as 13 separate
  dangling inter-layer arrows instead of one clean intra-layer edge) — fixed by generalizing the
  injection rule to any layer via one shared `isStrictlyUnder` primitive.
- **`LayerDocStackItem.id`'s synthetic `(docstack)` segment is checked-and-accepted, not
  proven collision-free** — same class of assumption as `ROOT_BLOCK_ID = '(root)'`
  (`decisions/0006`): a real directory literally named `(docstack)` would collide with it. Not
  hardened with a guaranteed-uncollidable marker (this codebase has one — `edges/
  layer-connections.ts`'s NUL-joined `pairKey`) given how low the real-world odds are relative
  to the cost of updating every test asserting today's human-readable id shape; revisit if a
  real repo ever actually hits it (`analyze-layer.ts`'s own header comment).
- `graph/layer`'s `items` are `WebviewLayerItem` (`shared/protocol.ts`: `LayerItem & { dirty:
  boolean }`), the same protocol-layer-augmentation pattern as `WebviewBlockNode` — dirty-file
  state is extension-host-only and never something `LayerGraphResult` itself carries. A
  `LayerDocStackItem` is dirty if ANY of its own constituent files is (exact-membership across
  the set, `commands/show-architecture.ts`'s `triggerLayerAnalysis`).
