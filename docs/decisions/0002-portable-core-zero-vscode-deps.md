# ADR-0002: Portable core — `core/` has zero VS Code dependencies

## Status
Accepted

## Date
2026-07-10

## Context
All of BlockNet's actual value — the truthful architecture graph — lives in the analysis
engine, not in VS Code integration glue. If the engine is entangled with `vscode` imports,
it can't be tested headless and can't be reused if a future webapp (ADR-0001's rejected,
deferred alternative) is ever built.

## Decision
Monorepo with two packages: `core/` (pure TS library + CLI, `analyze()` returns a
`GraphResult`, `cli.ts` prints it as JSON, zero `vscode` imports, enforced by
`core/test/no-vscode-import.test.ts`) and `extension/` (VS Code host + React webview),
which depends on `core/`.

## Alternatives Considered

### Single package, no boundary
- Pros: less scaffolding up front.
- Rejected: nothing stops `vscode` imports from leaking into analysis code over time; no
  headless testability; blocks the v2 webapp reuse path entirely.

## Consequences
`core` is unit-testable via `vitest` with zero mocking of VS Code APIs. The future webapp
funnel (`docs/planning/ROADMAP-V2.md`, v3) reuses `core` unchanged — it's a thin shell over
the same `GraphResult`. See `docs/architecture/LAYERS.md` for how this boundary maps to the
six-layer model.
