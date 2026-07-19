# ADR-0004: TypeScript/JavaScript only in v1

## Status
Accepted

## Date
2026-07-10

## Context
BlockNet could try to support every language on day one, or nail one language's graph
truthfully first. These are mutually exclusive uses of the same time budget.

## Decision
v1 analyzes TypeScript and JavaScript only.

## Alternatives Considered

### Python + TS from day one (ruff/pydeps for Python, dependency-cruiser for TS)
- Rejected for v1: doubles the surface area for Checkpoint A's truth gate before either
  language is proven. Deferred to `docs/planning/ROADMAP-V2.md` v2.5, additive by design —
  the aggregator architecture (ADR-0002) merges any analyzer's JSON output, so adding
  Python later doesn't require touching the TS path.

### Multi-language via LSP
- Rejected outright for bulk indexing — see ADR-0003. Reserved for v2 on-demand
  per-symbol drill-down.

## Consequences
Best-in-class tooling exists for TS/JS import resolution (dependency-cruiser). Every
fixture, every Checkpoint A real-repo test, and every risk check is validated against this
one language pair before any generalization is attempted.

## Clarification — 2026-07-19 (decisions/0005 Amendment 2)
This decision governs *import/edge and risk analysis* — the `Edge[]`/`Risk[]` this ADR's own
tooling choice (dependency-cruiser) produces. It does not, and was never intended to, govern
*block detection* or `fileCount`: a directory is a real architectural unit regardless of what
language it's written in, and hiding a repo's non-JS/TS content from the block graph's file
counts would be a truth gap, not a scope boundary. `docs/decisions/0005`'s 2026-07-19
Amendment 2 widened block detection and `fileCount` to be language-agnostic without touching
this ADR's actual decision: v1 still analyzes imports, and flags risks, for TS/JS only — a
non-JS block simply, honestly shows 0 edges. Recorded here because the original wording
("v1 analyzes TypeScript and JavaScript only") could be misread as covering block detection
too, which it was never meant to.
