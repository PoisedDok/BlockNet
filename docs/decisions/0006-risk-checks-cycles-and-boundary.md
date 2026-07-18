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
