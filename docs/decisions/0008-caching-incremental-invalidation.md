# ADR-0008: Caching and incremental invalidation

## Status
Accepted

## Date
2026-07-10

## Context
Real repos run 5,000–50,000 files; dependency-cruiser can take 30 seconds to 2 minutes cold.
`docs/PRINCIPLES.md`: a frozen editor or a minute-late graph gets uninstalled before it gets
a second chance. This has to be solved before Checkpoint A, not patched in afterward.

## Decision
First import = full scan with a progress UI (`analysis/progress` messages,
`docs/architecture/PROTOCOL.md`). `core/src/cache/store.ts` persists two things under
`context.storageUri`: the last `GraphResult` snapshot itself (so a warm open is an instant
deserialize, not a re-analysis) and the content-hash `CacheManifest` used to decide what,
if anything, is now stale. `workspaceState` holds neither of these — only a pointer to the
cache location plus node positions. Subsequent opens load the snapshot instantly, then run
a delta pass only for files the manifest marks dirty.

Invalidation rules:
1. File **content hash** change → re-analyze only that file's edges (the expensive,
   I/O-bound, AST-parsing step) and recompute the affected block's aggregate edges. **Cycle
   detection does not use this scoping.** Tarjan SCC always re-runs over the full in-memory
   edge list on every analysis, cold or incremental — it's a single `O(V+E)` pass with no
   I/O once edges are known (the file graph, cached or fresh, is already resident in
   memory), typically low-single-digit milliseconds even at 50k files. A prior draft of
   this decision proposed scoping SCC recomputation to only "the affected component," which
   is not actually correct: an edge addition can merge two previously-separate strongly
   connected regions, and an edge removal can split one, and neither is detectable from a
   purely local view without doing the reachability work that makes the scoping pointless.
   Since whole-graph Tarjan is cheap, there is no correctness/performance tradeoff worth
   taking here — the incrementality is spent entirely on edge *extraction*, never on cycle
   detection.
2. File **add / delete / rename** (via `vscode.workspace.createFileSystemWatcher`).
3. **Config change** (`tsconfig.json`, `package.json`, alias maps) → full cache bust.

Triggers for rules 1–2 are debounced and generation-tagged before they reach `core` at all
— see `docs/architecture/FLOWS.md` §2a. `cache/store.ts` always writes via
write-temp-then-rename (atomic on the same volume on POSIX and NTFS), so a manifest/snapshot
read is never torn even if two VS Code windows on the same repo write concurrently — see
`docs/architecture/STATE-OWNERSHIP.md`.

## Alternatives Considered

### Always full-scan, rely on raw speed
- Rejected: dependency-cruiser's resolution cost scales with repo size regardless of
  optimization; no amount of raw speed avoids a 30s–2min cold scan on a 50k-file repo.

### LSP-based incremental indexing
- Rejected — see ADR-0003. RPC-per-symbol doesn't scale to bulk re-indexing even
  incrementally.

### Scoping SCC recomputation to only the changed file's local component
- Rejected: provably insufficient (see rule 1 above) — misses merges and splits that touch
  nodes outside the naively "affected" set. Replaced by whole-graph Tarjan on every run,
  which is cheap enough that the scoping was solving a problem that didn't exist.

## Consequences
Analysis always runs in a forked child process
(`docs/architecture/PROCESS-BOUNDARY.md`), never on the extension host thread — this is
non-negotiable regardless of cache state, since even a cache-miss delta pass must not
freeze typing. `dependency-cruiser`'s traversal excludes `node_modules`, `dist`, `build`,
`out`, `coverage`, and every dot-directory (`.git`, `.next`, and any other build/cache
output a framework generates) by binding configuration, not convention — see ADR-0003 —
so the "cheap once edges are known" framing above holds even on repos with large vendored
trees.
