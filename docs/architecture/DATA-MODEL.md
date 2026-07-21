# Architecture — Data Model

All ten types live in `core/src/types.ts`. `GraphResult` is the payload that crosses the
child-process boundary unmodified (`ipc-worker.ts` → `analysis-runner.ts`). From there, the
extension host splits it across two webview messages, renaming one field to match React
Flow's own vocabulary: `GraphResult.blocks` becomes `graph/macro`'s `nodes`,
`GraphResult.edges` stays `edges`, `GraphResult.risks` becomes the separate `risks/update`
message, and `GraphResult.meta` is not forwarded — it's host-internal (cache-hit bookkeeping
the webview has no use for). See
[PROTOCOL.md](./PROTOCOL.md) for the exact message shapes.

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
