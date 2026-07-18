# ADR-0005: Blocks are auto-detected, zero config

## Status
Accepted

## Date
2026-07-10

## Context
"What counts as a block" needs an answer before a graph can render, for every repo shape
from a tight monorepo to a flat single-package app. Requiring config up front kills the
10-second first-run experience.

## Decision
A detection cascade, first non-empty strategy wins:
1. `package.json` workspaces / tsconfig project references (monorepos)
2. Top-level `apps/` | `packages/` | `services/` | `libs/` | `infra/` folders
3. Fallback for flat repos: top-level folders under `src/`

Whichever strategy wins, `detect.ts` always appends one synthetic **`(root)`** block
covering any file that matches none of the detected blocks' path prefixes (root-level
shared utilities, config files, anything outside every detected folder). It is populated
lazily — it only appears in `BlockNode[]` if `resolve-block.ts` actually finds an
unmatched file — but its existence is not optional. The alternative (silently dropping that
file's edges) contradicts `docs/PRINCIPLES.md`'s truth requirement more than an ungainly
extra node does.

## Alternatives Considered

### Config-first (`blocknet.json` required)
- Rejected for v1: kills the zero-config wow of the first open. Deferred to
  `docs/planning/ROADMAP-V2.md` v2.5 as an *override* for repos where the heuristic guesses
  wrong — additive, not a replacement for the cascade.

## Consequences
Known risk: the flat-repo fallback may produce weak or meaningless blocks on unconventional
repos. This is explicitly validated at Checkpoint A (`docs/planning/TASKS-V1.md`) before any
UI work starts — if the fallback produces noise on real repos, the engine gets fixed before
Phase 2 begins, not patched around later.
