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
