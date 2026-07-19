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
`node_modules`, `dist`, `build`, `out`, `coverage`, and **every dot-directory** (`.git`,
`.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.cache`, `.vercel`, ...) from traversal,
regardless of the target repo's own `.gitignore` or lack thereof. This is a fixed part of
`depcruise-runner.ts`'s configuration, not an assumption — the "5,000–50,000 source files"
performance framing used throughout these docs (`docs/decisions/0008`) is meaningless
without it, since a `node_modules` tree alone routinely exceeds that range by an order of
magnitude. Dot-directories are excluded as a category, not an enumerated list of names: a
real-repo run against a Next.js app during Task 3 found `.next/`'s 345 generated files
leaking into the graph as source before this was categorical — the same rule
`blocks/fs-utils.ts` already applies for block detection (`docs/planning/PROGRESS.md`'s
Task 3 entry).

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

**BlockNet resolves tsconfig `paths` aliases itself, not via dependency-cruiser's own
`tsConfig` cruise option.** Confirmed by direct testing during Task 3: dependency-cruiser's
`tsconfig-paths-webpack-plugin` resolves `paths` relative to `process.cwd()`, not the
`baseDir` cruise option — and `analyze()` can be invoked from any cwd (a forked
`ipc-worker.ts` process inherits the extension host's cwd, not the analyzed repo's), so
every aliased import would silently break whenever cwd ≠ rootDir. `depcruise-runner.ts`
instead reads `paths`/`baseUrl` directly and translates them into enhanced-resolve's
`alias` resolve option with absolute targets, which is cwd-independent. This is still "we
write the aggregator, not the parser" — enhanced-resolve (already inside
dependency-cruiser) does 100% of the actual resolution; only the config handed to it is
computed by BlockNet instead of dependency-cruiser's own tsconfig plugin.
