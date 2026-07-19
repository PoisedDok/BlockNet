# ADR-0005: Blocks are auto-detected, zero config

## Status
Accepted

## Date
2026-07-10 (Decision's strategy 2 amended 2026-07-19 — see Amendment below; read the
Decision section as describing the post-amendment mechanism)

## Context
"What counts as a block" needs an answer before a graph can render, for every repo shape
from a tight monorepo to a flat single-package app. Requiring config up front kills the
10-second first-run experience.

## Decision
A detection cascade, first non-empty strategy wins:
1. `package.json` workspaces / tsconfig project references (monorepos)
2. A generic structural host-walk: breadth-first from the root's children, per branch — a
   directory that owns a `package.json` ("hosts" a real project) becomes a block and its
   own subtree is never searched further; a directory that isn't a host is expanded one
   level deeper, up to 4 levels below root. No folder-name vocabulary — see the 2026-07-19
   amendment below for why.
3. Fallback for flat repos: top-level folders under `src/`

Whichever strategy wins, the pipeline always appends one synthetic **`(root)`** block
covering any file that matches none of the detected blocks' path prefixes (root-level
shared utilities, config files, anything outside every detected folder). It is populated
lazily — it only appears in `BlockNode[]` if `resolve-block.ts` actually finds an
unmatched file — but its existence is not optional. The alternative (silently dropping that
file's edges) contradicts `docs/PRINCIPLES.md`'s truth requirement more than an ungainly
extra node does. `detect.ts` itself never appends it: `detect.ts` never walks files, so it
cannot honestly know one is needed until edge resolution (`edges/resolve-block.ts`) finds a
genuinely unmatched file — `analyze.ts` is the one that appends it, conditionally, once that
happens (see `docs/architecture/DIRECTORY-TREE.md`'s `blocks/detect.ts` annotation).

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

## Amendment — 2026-07-19 (Checkpoint A)

Strategy 2's original mechanism (as first shipped) was a hardcoded folder-name list —
`apps/`, `packages/`, `services/`, `libs/`, `infra/` only. Checkpoint A's real-repo run
against `AetherArenaV2` (a genuine ~4,600-file monorepo split into `frontend/`, `backend/`,
`desktop/`, `open-connector/` — none of which match that vocabulary, and with no root
`package.json` workspaces field either) collapsed the entire repo into one meaningless
`(root)` block with zero edges: not "noisy," a total truth-gate failure, on a real,
actively-developed codebase. This is exactly the failure mode this ADR's own Consequences
section flagged for Checkpoint A to catch.

Root cause: real repos name their sub-projects by role (`frontend`/`backend`/`client`/`api`),
not by a fixed vocabulary — hardcoding folder names was never going to generalize. Fixed by
replacing the name-list with the generic structural host-walk described in the Decision
above (`core/src/blocks/structural.ts`, superseding the deleted `conventional.ts`). Re-run
against the same repo: 4 real blocks (`frontend`, `desktop`, `open-connector`, tiny
`(root)`), file counts summing exactly to the real total, no regression on any
previously-passing real repo (`aetherinc`, `aether-proxy`, BlockNet analyzing itself).

Deliberately not done in this amendment: recognizing non-JS/TS project manifests
(`pyproject.toml`, `go.mod`, etc.) as hosts too, so a polyglot repo's non-JS sub-projects
(like `AetherArenaV2/backend`, a real Python project) also appear as blocks. `fileCount`
(`analyze.ts`) is currently derived solely from dependency-cruiser's TS/JS module list — a
non-JS host would show `fileCount: 0` today, the same phantom-empty-block symptom already
tracked in `docs/planning/PROGRESS.md`'s "Tracked risks" section, just guaranteed instead of
incidental. That generalization needs `fileCount` fixed to count real files generically
first; tracked as a separate follow-up there, not bundled into this fix.
