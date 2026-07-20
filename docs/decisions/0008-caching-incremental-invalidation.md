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

## Amendment — 2026-07-19 (Task 5 implementation)

Three points this ADR left open or ambiguous, resolved during `core/src/cache/`'s build:

1. **File add/delete/rename is a full bust, not a scoped delta — deliberately, not an
   unexploited optimization.** Rule 1 above only scopes a pure *content* edit to an
   already-existing file. Correctly scoping an add or delete would require knowing which
   *other* files' imports would newly resolve (or stop resolving) because of it — e.g. a
   previously-`couldNotResolve` specifier now matching a just-added file, or a barrel
   `index.ts` appearing/disappearing. That requires a reverse index over every file's
   *unresolved* import specifiers, which this engine doesn't build and was rejected as an
   unvalidated guess — the same class of mistake this ADR already rejected once for SCC
   scoping (see "Scoping SCC recomputation..." above). Falling back to a full rescan for any
   add/delete is the safe, correct choice. `cache/invalidate.ts`'s `structural-changed` plan
   kind is this case; its header comment carries the same rationale.

2. **The manifest, the `GraphResult` snapshot, and the pre-aggregation `FileEdge[]` the
   delta path merges into are persisted together, in ONE JSON file, not two or three
   independently-atomic ones.** Write-temp-then-rename makes each *individual* file's write
   atomic, but a crash between two *separate* atomic writes (manifest, then snapshot) could
   leave a newer manifest on disk paired with a stale snapshot — `cache/invalidate.ts` would
   diff fresh reality against the already-updated manifest, see no difference, and serve the
   stale snapshot forever. One combined file removes the possibility of that interleaving
   entirely. See `docs/architecture/STATE-OWNERSHIP.md`.

3. **A file outside TS/JS's resolvable extensions never has its content hashed at all — a
   constant placeholder is used instead.** Discovered as a real, not hypothetical, problem:
   validating against the Checkpoint A real-repo set, `aetherinc` was found to have grown a
   504MB checked-in Docker image archive and two 69MB PDFs since Task 3. `buildManifest`'s
   first implementation read every real file's full bytes to hash it (needed to detect
   content changes for the delta path) — for these files specifically, that turned a claimed
   near-instant cache hit into a ~10-second read, on every single call, cache hit or not. Since
   import/edge analysis is TS/JS-only (decisions/0004), a non-source file's content can
   *never* produce or change a `FileEdge` — only its *existence* matters, for `fileCount` and
   structural-change detection, both already covered by the manifest's key set regardless of
   what hash value is stored. `cache/manifest.ts` now only reads real content for
   `package.json`/`tsconfig.json` and files matching `risks/boundary.ts`'s
   `RESOLVABLE_EXTENSIONS` vocabulary; everything else gets a constant, content-independent
   placeholder. Re-measured after the fix: `aetherinc`'s warm (unchanged) run dropped from
   ~10.1s to ~38ms; `AetherArenaV2` (6,545 files) from ~4.7s cold to ~211ms warm.

4. **`.mts`/`.cts` were missing from both `manifest.ts`'s extension list and
   `risks/boundary.ts`'s pre-existing `RESOLVABLE_EXTENSIONS`** — found by this task's own
   adversarial review, not by real-repo validation. dependency-cruiser parses both as
   TS-compatible (`tsPreCompilationDeps: true`), so a real edit inside a `.mts`/`.cts` file
   (a native ESM/CJS TypeScript pattern — a real `vite.config.mts` is mainstream, not
   exotic) was silently bucketed as "non-source": its hash never moved, so
   `cache/invalidate.ts` never saw it as dirty and the cache would have served stale
   edges/risks indefinitely. Confirmed by direct reproduction. Fixed both extension lists.

5. **The content-changed merge's array-membership check (`Array.includes()` against the
   modified-files list) was O(cachedEdges × modifiedFiles) instead of O(cachedEdges).**
   Benchmarked during review: 300k edges / 5k modified files = 3.68s with `.includes()` vs
   19ms with a `Set`. A repo-wide reformat or branch switch on a real 50k-file repo could
   plausibly reach this scale, which would have made the "instant delta" path slower than
   the full cold scan it exists to replace — directly undermining this ADR's own
   performance rationale. Fixed: the merge now builds a `Set` once per call.

6. **`CacheManifest.files[path].blockId` was computed but read by nothing** —
   `resolveBlock`'s already-flagged O(files×blocks) cost (see `docs/planning/PROGRESS.md`'s
   "Tracked risks") was being paid twice per full scan for a field with zero consumers.
   Since `CacheManifest` is a purely internal cache-file format (unlike `GraphResult`,
   nothing outside `core/cache`/`analyze.ts` depends on its shape), the field was removed
   entirely rather than wired to a speculative future consumer.
