# ADR-0003: Edges built with dependency-cruiser; ts-morph and LSP deferred

## Status
Accepted

## Date
2026-07-10

## Context
Import resolution across aliases, barrels, and monorepo workspaces is the genuinely hard,
easy-to-get-wrong part of this product. Getting it wrong is fatal to trust (see
`docs/PRINCIPLES.md` — false positives are fatal).

## Decision
v1 builds file→file edges with **dependency-cruiser**, called via its in-process
programmatic API (not its CLI). We write the aggregator (file edges → block edges), not a
parser.

**Binding exclusion rule:** the dependency-cruiser configuration always excludes
`node_modules`, `.git`, `dist`, `build`, `out`, and `coverage` from traversal, regardless of
the target repo's own `.gitignore` or lack thereof. This is a fixed part of
`depcruise-runner.ts`'s configuration, not an assumption — the "5,000–50,000 source files"
performance framing used throughout these docs (`docs/decisions/0008`) is meaningless
without it, since a `node_modules` tree alone routinely exceeds that range by an order of
magnitude.

## Alternatives Considered

### ts-morph (TS Compiler API wrapper)
- Pros: precise, gives access to symbols/functions for a future drill-down layer.
- Rejected for v1: dependency-cruiser already solves import resolution (aliases, barrels,
  workspaces) plus ships a rule engine — no need to rebuild that. ts-morph enters in v2 for
  the file→function drill-down layer (`docs/planning/ROADMAP-V2.md`, v2.0), where its
  symbol-level access actually earns its cost.

### LSP (Language Server Protocol)
- Pros: works for any language with an installed server; "just ask the language server."
- Rejected for bulk indexing: LSP is RPC to a separate process, designed for one-symbol
  interactive queries. Bulk graph-building across a whole repo is thousands of round-trips
  — minutes, not seconds. Reserved for v2 on-demand drill-down only, never bulk indexing.

## Consequences
v1 is TypeScript/JavaScript only (ADR-0004) because this is where dependency-cruiser's
resolution is most mature. `core/src/edges/depcruise-runner.ts` is the only place
dependency-cruiser is invoked; everything downstream consumes its normalized output.
