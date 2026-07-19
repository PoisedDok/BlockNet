# ADR-0005: Blocks are auto-detected, zero config

## Status
Accepted

## Date
2026-07-10 (Decision amended twice on 2026-07-19 — see Amendments below; read the Decision
section as describing the post-amendment mechanism)

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

After that base cascade resolves (whichever of the 3 strategies won, or none did), an
additive fourth step (`core/src/blocks/other-languages.ts`) checks rootDir's own immediate
top-level children — and *only* that level, deliberately not recursive — for a project
manifest in a language other than JS/TS (`pyproject.toml`, `go.mod`, `Cargo.toml`,
`Dockerfile`, ... — see fs-utils.ts's `hasOtherLanguageManifest`), skipping any child already
covered by a block the base cascade found. This is how a real polyglot repo's Python/Go/Rust
sibling (e.g. `AetherArenaV2/backend`) shows up as its own block even though strategies 1-3
stay JS/TS-only — see the second 2026-07-19 amendment below for why this step is additive and
shallow rather than folded into strategy 2's own recursive search.

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

## Amendment 2 — 2026-07-19 (multi-language blocks + generic fileCount)

The follow-up flagged above: `fileCount` (`analyze.ts`, both per-block and `meta.fileCount`)
now comes from a generic all-languages file walk (`core/src/file-walk.ts`) instead of
dependency-cruiser's TS/JS-only module list — every real file counts, any language, using the
same exclude rules (`node_modules`, build output, dot-directories) as the rest of the
pipeline (`path-utils.ts`'s `EXCLUDE_PATTERN_SOURCE`, now shared by both). Import/edge
analysis stays TS/JS-only (`decisions/0004`, unchanged) — a non-JS block honestly shows 0
edges, not a lie, just the boundary of what v1 analyzes.

**First attempt, reverted after it broke a previously-passing real repo — recorded here, not
quietly dropped:** the first version of this work widened strategy 2's own host signal
(`structural.ts`) to recognize any of a dozen manifest types (`pyproject.toml`, `go.mod`,
`Cargo.toml`, `Dockerfile`, ...), reusing its existing 4-level recursive per-branch search.
Re-running Checkpoint A's real-repo set immediately surfaced two new real bugs:

1. **Cascade hijacking.** `aetherinc` — previously correctly detected via strategy 3's flat
   `src/` fallback (6 real blocks: `src/app`, `src/components`, `src/lib`, ...) — collapsed to
   2 blocks, one of them a single incidental `pyproject.toml` found 4 levels deep inside
   `project/agent-skills/red-team-skills/constant-time-analysis/` (a Claude Code tooling
   directory, nothing to do with the actual Next.js application). Because strategy 2's *any*
   non-empty result unconditionally wins the "first non-empty strategy" cascade, one spurious
   deep manifest — the kind any sufficiently large real repo tends to have somewhere — was
   enough to discard a correct, much more relevant result. This was never reachable before:
   the old JS/TS-only `hasPackageJson` check made a spurious match this unlikely in practice,
   but the real fix is architectural, not "get lucky with the manifest list."
2. **Vendored build output counted as source.** Recognizing `Cargo.toml` as a host signal
   surfaced a real Rust project (`AetherArenaV2/desktop`'s Tauri shell) — whose `target/`
   directory (Cargo's build output, analogous to `node_modules`) was NOT covered by
   `EXCLUDE_PATTERN_SOURCE`, which only knew about JS-ecosystem output directories. Measured
   result: a `desktop` block with **131,144 files**, almost entirely vendored Cargo build
   artifacts counted as if they were source. Recognizing a language as a block-detection host
   without also excluding its build/dependency output is only half a fix.

**Both fixed, not patched around:**
1. `structural.ts` reverted to JS/TS-only (`hasPackageJson`) — its recursive, multi-level
   search is a validated mechanism for JS/TS monorepos (Amendment 1) and stays scoped to what
   it was actually proven correct for. Non-JS host detection moved to the new, deliberately
   *additive and shallow* `other-languages.ts` (Decision section above): top-level-only, never
   able to preempt or replace what the base cascade already found, so one incidental deep
   manifest anywhere in the tree can no longer hijack an unrelated repo's real structure.
2. `EXCLUDE_PATTERN_SOURCE` widened to also exclude `target` (Rust/Java-Maven), `__pycache__`
   and `venv` (Python), and `vendor` (Go/PHP/legacy JS) — the same "every current or future
   [language]'s build/cache output" principle `.next`/`.nuxt`/etc. dot-directory exclusion
   already establishes for JS frameworks, extended to the languages block detection now
   recognizes.

Re-validated against all 4 Checkpoint A real repos after both fixes: `aetherinc` back to 6
correct blocks (no regression), `AetherArenaV2/desktop` back to a sane 122 files,
`AetherArenaV2/backend` now correctly appears (510 files, real Python content, 0 pills —
honest, not misattributed from the root's unrelated JS dependencies via `pills.ts`'s
fallback, which was also fixed during this work to distinguish "no manifest at all" from "a
manifest in a different language" before falling back to root).

**Correction, same day, found by an immediate follow-up adversarial review:** fix 2 above
(the `EXCLUDE_PATTERN_SOURCE` widening) was necessary but not, on its own, sufficient —
`blocks/fs-utils.ts`'s `listChildDirectories`, the directory-traversal primitive every
block-detection strategy actually walks through, was never wired to the shared exclude
predicate at all (it had its own older, narrower dot-dir/`node_modules`-only filter). A
`package.json` vendored inside `vendor/`/`dist`/`target` could still produce a spurious block
and still hijack the cascade — the same failure class this whole amendment exists to close,
just reachable through a different manifest type. Fixed by routing
`listChildDirectories` through `path-utils.ts`'s `isExcludedPath` too. Full account in
`docs/planning/PROGRESS.md`'s "Round 2 adversarial review" entry, including a second real bug
found the same pass (`file-walk.ts`'s real-path dedup covered directories but not individual
files).
