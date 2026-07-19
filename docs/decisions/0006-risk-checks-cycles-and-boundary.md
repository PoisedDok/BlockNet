# ADR-0006: v1 risk checks are cycles + one boundary rule, nothing else

## Status
Accepted

## Date
2026-07-10

## Context
`docs/PRINCIPLES.md` states false positives are fatal — a single wrong red edge destroys
trust in the whole tool. Every candidate risk check has to be weighed against that bar
before it ships, not after.

## Decision
Exactly two checks in v1:
- **CIRCULAR** — Tarjan SCC over the import graph; flag every edge inside a strongly
  connected component with more than one node. Fix hint: extract the shared contract into a
  third package.
- **BOUNDARY** — a file in block A imports a path of block B that is not one of B's
  *declared entry points*. "Declared entry points" means: every subpath key in B's
  `package.json` `exports` map when one exists (not just `main`), or `main`/`index.ts` when
  it doesn't. A deep import matching a declared `exports` subpath (e.g. a package that
  intentionally exposes `"./utils"` alongside its root) is **not** a violation — only a path
  that bypasses the declared surface entirely is. This distinction is load-bearing: `exports`
  maps with multiple legitimate subpaths are common in modern packages, and treating every
  non-root import as a violation would flag them as false positives on sight.

## Alternatives Considered

### DIRECT-DB / secret-reaches-client (reachability/taint analysis)
- Pros: high-value — flags a client-reachable module importing a DB driver or reading a
  secret env var.
- Rejected for v1: reachability analysis is the noisiest class of check; false positives
  here are close to guaranteed without a validated recipe. Deferred to
  `docs/planning/ROADMAP-V2.md` v2.4, planned in order of increasing power (Semgrep rules
  first, then bundler-graph reachability, CodeQL only if real taint is unavoidable).

## Consequences
Cycles have ~zero false positives by construction (SCC membership is a hard graph fact).
The boundary rule's precision comes entirely from the "deep path vs. declared entry"
definition — `boundary.ts` must resolve against the target block's *full* `exports` map,
not a single hardcoded entry file, or it re-introduces exactly the false-positive risk this
ADR exists to avoid. Each risk check's zero-FP bar is re-verified against the Checkpoint A
real repos before Task 4 is considered done (`docs/planning/TASKS-V1.md`) — real repos are
what will actually exercise `exports`-map usage, not the fixtures alone.

## Amendment — 2026-07-19 (Task 4 implementation)

Two things this ADR left underspecified turned out to be load-bearing once built against
real repos, not just fixtures. Both are now precise, permanent rules, not implementation
details left to whoever reads the code.

**1. "Declared entry points... `main`/`index.ts` when [`exports`] doesn't [exist]" — the
exact resolution algorithm.** Implemented in `core/src/risks/boundary.ts`:
- If `exports` exists: every string leaf anywhere in it (a single string, an array, a flat
  subpath map, or nested condition objects like `{"import": ..., "require": ..., "types":
  ...}` at any depth) is a declared entry. `main` is ignored once `exports` exists — Node's
  own module-resolution semantics.
- Else if `main` exists: its resolved target is the sole declared entry.
- Else: the block's own conventional index file — checked at **both** `<block>/index.*` and
  `<block>/src/index.*`, not literally just the block root. A block-root-only reading (the
  literal words "index.ts" taken narrowly) would misfire as BOUNDARY on nearly every real
  unbuilt TS/JS monorepo package, since source conventionally lives under `src/`, not the
  package root. Confirmed against the real monorepo fixture built for this rule:
  `packages/c` has no `main`/`exports`, and its real entry is `packages/c/src/index.ts`.
- Every declared-path candidate (from `exports`, `main`, or the index-file fallback) is
  resolved to the real file on disk the same way TypeScript/dependency-cruiser would: the
  literal path first, then the same path with a source extension swapped in (`main:
  "./dist/index.js"` commonly points at build output that doesn't exist in an unbuilt
  source tree — only its `.ts` sibling does), then as a directory needing its own index
  file.

**2. A block that owns no `package.json` at all has no declared-entry concept, and BOUNDARY
never applies to it as a target.** Not stated in the original Decision — and its absence
was a real, not hypothetical, false-positive bug caught during Checkpoint A's real-repo
re-validation after Task 4 first landed: `aetherinc`'s flat-fallback blocks (`src/app`,
`src/components`, `src/lib` — strategy 3, "top-level folders under `src/`", explicitly no
manifest of any kind) got **100% of their real crossing edges flagged BOUNDARY** — every
one of 4 real block edges — because the "no `exports`, no `main`" fallback tried to resolve
a conventional `index.ts` these directories were never meant to have, found none, and
treated every import as a violation. A flat-fallback block is a directory grouping inside
one single application, not a package with a designed public API; there is no real boundary
to violate. Fixed: `findBoundaryViolations` skips any target block where
`hasPackageJson(block.path)` is false, before ever computing declared entries. The same
signal `workspaces.ts`/`structural.ts` already use for "is this a real self-contained
project," reused rather than re-derived.

Re-verified against all 4 Checkpoint A real repos after the fix: 0 risks everywhere. Worth
recording honestly — none of the 4 currently exercises a true BOUNDARY or CIRCULAR
positive (`aetherinc`'s only crossing edges are into now-correctly-exempted flat-fallback
blocks; the other three have zero crossing edges of any kind, established during
Checkpoint A's earlier real-repo review). The true-positive path is verified by the
checked-in monorepo fixture (byte-checked evidence) and extensive synthetic Tarjan/
declared-entry unit tests, not yet by a real repo naturally triggering one.
