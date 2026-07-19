# BlockNet v1 — Progress Tracker

Companion to [TASKS-V1.md](./TASKS-V1.md) — tracks what's *actually done* vs. that plan, so
work can resume cold without re-deriving context. Update this file as tasks complete. Do
not rewrite TASKS-V1.md/ROADMAP-V2.md themselves (`CLAUDE.md`).

## Status at a glance

| Phase | Status |
|---|---|
| Phase 1 — Engine (Tasks 1-5) | Tasks 1-4 done. Task 5 not started. |
| Checkpoint A (truth gate) | Signed off with Krish 2026-07-19 — see below. |
| Checkpoint B (engine complete) | Not reached. |
| Phase 2 — Extension (Tasks 6-9) | Not started — blocked on Checkpoint B. |
| Phase 3 — Ship (Task 10) | Not started. |

## Done

### Task 1 — Scaffold monorepo + core package with CLI skeleton ✅ (2026-07-18)
- npm workspaces root (`workspaces: ["core"]` — `extension` deliberately deferred to Task 6)
- `core/src/{types.ts, analyze.ts, cli.ts, index.ts}` — `analyze()` is a stub returning an
  honest empty `GraphResult`; `cli.ts` has strict argv parsing (`analyze <path> [--json]
  [--cache-dir <dir>]`), hard-errors on unknown flags/missing path/missing flag value.
- `core/test/{no-vscode-import.test.ts, cli.test.ts}` — 11 tests passing.
- Root CI gate wired: `npm ci → build --workspaces → test --workspaces → lint`.
- Verified live: `npm run build && npm test && npm run lint` green; `npx blocknet analyze .`
  emits schema-valid JSON (Task 1's literal acceptance criteria).
- Two-pass adversarial review done (repo-hygiene + architectural-soundness). Confirmed fix:
  CLI parser silently swallowed unknown flags / missing path — now hard-errors. Also fixed:
  temp-dir leakage in tests, missing `pretest` auto-build, undocumented TS 5.9.3 pin
  (recorded in CONTRIBUTING.md), two doc miscounts (DATA-MODEL.md said "eight types",
  actually ten), `agent-skills/` unacknowledged in REPO-STANDARDS.md's root list.

## Done (continued)

### Task 2 — Block auto-detection cascade ✅ (2026-07-18)
ADR: [decisions/0005](../decisions/0005-blocks-auto-detected.md). Built in `core/src/blocks/`:
- `internal-types.ts` — `BlockCandidate` (name + path), the pre-pills shape strategies return.
- `workspaces.ts` (strategy 1) — npm/yarn `package.json` `workspaces` (array or `{packages}`
  form; single trailing `/*` glob or a literal dir, both required to have their own
  `package.json`) merged with `tsconfig.json` `references` (parsed with `jsonc-parser` — real
  tsconfig files carry comments, plain `JSON.parse` would break on real repos; malformed
  tsconfig degrades to "no reference candidates," never a crash, and logs a warning via the
  new `log.ts`).
- `conventional.ts` (strategy 2) — one block per second-level dir under any of
  `apps/ packages/ services/ libs/ infra/`.
- `flat-fallback.ts` (strategy 3) — one block per top-level dir under `src/`.
- `detect.ts` — cascades the three, first non-empty wins; assembles full `BlockNode[]`
  (`id` = `path`, `pills` via `pills.ts`, `fileCount`/`riskCount` = 0 — honest, not
  fabricated, until Task 3 walks files).
- `pills.ts` — tech pills = sorted union of the block's own (or, if absent, the repo root's)
  `package.json` `dependencies` ∪ `devDependencies`. Real deps, not a curated allowlist.
- `fs-utils.ts` — shared symlink-following directory listing (`listChildDirectories`) and a
  rootDir-containment guard (`toBlockRelativePath`), used by all three strategies. Factored
  out during the adversarial review fixes below — the same symlink bug existed in three
  places independently before this existed.
- `core/src/log.ts` (added, per `DIRECTORY-TREE.md`'s note it lands with Task 2) — tiny
  leveled logger, no-op sink by default ("no I/O side effects as a library"), never wired to
  stdout (`PROCESS-BOUNDARY.md` reserves stdout for the JSON result).
- Fixtures added: `core/test/fixtures/{monorepo,flat-repo}` per `DIRECTORY-TREE.md`'s spec
  (monorepo = `packages/{a,b,c}`, each with a real dependency for pill testing; the `b↔c`
  cycle / `a`-deep-imports-`c/src/internal` content described in that doc is Task 3/4's to
  add when cycle/boundary detection actually exists — building it now would be unvalidated
  guessing at Task 3's exact shape).
- 61 new tests (72 total), all real-filesystem (temp dirs / checked-in fixtures), no mocks.
- **Root synthetic `(root)` block is deliberately NOT built in `detect.ts`.** The ADR
  describes it as populated lazily by whatever `resolve-block.ts` (Task 3) finds unmatched —
  `detect.ts` never walks files, so it cannot honestly know yet whether one is needed.
  `analyze.ts` will append it conditionally once Task 3 exists. Documented in `detect.ts`.
- **CI/local gate hardened while building this:** `npm run build` (tsup) only type-checks
  files reachable from `core`'s entrypoints — a file not yet wired in can carry a type error
  and still pass `build` silently (caught firsthand: a `jsonc-parser` type mismatch in
  `workspaces.ts` passed `build` clean, `tsc --noEmit` caught it immediately). Added a
  separate `typecheck` script (`tsc --noEmit`) to both `core/package.json` and root
  `package.json`, wired into `.github/workflows/ci.yml`, and added a `.githooks/pre-push`
  hook (installed via `prepare` → `git config core.hooksPath .githooks`, zero new
  dependency) running build → typecheck → test → lint before any push leaves the machine.
  See `CONTRIBUTING.md`.
- **Two-pass adversarial review done** (doc-consistency + architectural-soundness, per
  `CLAUDE.md`'s verification ritual). Doc-consistency pass caught real drift, fixed:
  `REPO-STANDARDS.md` still said "no git hooks" — silently contradicted by the new
  `.githooks/pre-push` until reconciled (see above); `DIRECTORY-TREE.md` still claimed
  `detect.ts` unconditionally appends the `(root)` block, still listed CI as four gates
  (missing `typecheck`), still named a single `blocks.test.ts` (actual: five split files
  plus `log.test.ts`), and described the monorepo fixture's cycle/deep-import content as
  already present. Architectural-soundness pass found five real bugs in the strategy code,
  all fixed with a failing regression test written first, matching TDD discipline:
  1. `workspaces.ts`'s `/*` glob branch called `readdirSync` unguarded — a permission-denied
     base directory (root-owned Docker artifact, locked-down mount) crashed the entire
     analysis instead of degrading to other patterns/strategies.
  2. All three strategies used `Dirent.isDirectory()`, which does not follow symlinks — a
     symlinked workspace/block member (pnpm-style linking, Nx/Bazel-generated layouts)
     silently vanished. Fixed by extracting `fs-utils.ts`'s symlink-following
     `listChildDirectories`, used everywhere a strategy lists candidate directories.
  3. A self-referencing tsconfig reference (`{"path": "."}`) produced a `BlockNode` with
     `id: "", path: ""`.
  4. Nothing verified a workspace pattern or tsconfig reference stayed inside `rootDir` — a
     sibling-project reference (`../shared`, ordinary when only a subdirectory of a larger
     monorepo is open) leaked a `..`-prefixed path into `GraphResult`, a dead node no file
     could ever resolve to.
  5. `derivePills` didn't validate `dependencies`/`devDependencies` shape — a corrupted
     `package.json` with `dependencies` as an array or string produced garbage pills `"0"`,
     `"1"`, ... via `Object.keys()`, not a crash but a silent truth violation.
  Also fixed as a defensible-tradeoff finding: the tsconfig JSONC parser bailed on *any*
  parse error, even one unrelated to `references` (e.g. a stray missing comma inside
  `compilerOptions`) — now only warns, since jsonc-parser's error recovery reconstructs
  `references` correctly in that case and each reference is independently validated
  against the filesystem regardless.
- **Real-repo smoke test (ahead of Checkpoint A, informal):** ran `blocknet analyze --json`
  against `aetherinc` (real flat Next.js app) and `aether-proxy` (single-file repo, no `src/`
  at all). `aether-proxy` correctly returns zero blocks — no fabrication. `aetherinc`
  reproduces the exact risk ADR-0005 already names in its Consequences: the flat-`src/`
  fallback treats `src/__tests__` as a block, which is noise, not an architectural unit.
  **Not fixed here** — ADR-0005 explicitly assigns this class of finding to Checkpoint A
  ("if the fallback produces noise on real repos, the engine gets fixed before Phase 2
  begins"), and guessing at an exclude-list (`__tests__`, `__mocks__`, etc.) without
  validating it against the actual Checkpoint A repo set would be exactly the kind of
  unverified heuristic patch `CLAUDE.md` warns against. Tracked below instead.

## Done (continued)

### Task 3 — Edge extraction via dependency-cruiser + block aggregation ✅ (2026-07-19)
ADR: [decisions/0003](../decisions/0003-dependency-cruiser-not-ts-morph-lsp.md). Built in
`core/src/edges/`:
- `depcruise-runner.ts` — invokes `dependency-cruiser`'s in-process `cruise()` API. Binding
  exclude: `node_modules`, `dist`, `build`, `out`, `coverage`, and every dot-directory
  (regex, not an enumerated list). Resolves tsconfig `paths` aliases itself via
  enhanced-resolve's `alias` resolve option (absolute targets), not dependency-cruiser's own
  `tsConfig` option. Always passes `tsPreCompilationDeps: true`. Always resolves `rootDir` to
  its real path first.
- `file-graph.ts` — normalizes dep-cruiser's module graph → `FileEdge[]`, recovering each
  edge's `statement`/`line` (dependency-cruiser's own output has neither) via a line scan for
  the literal specifier text, skipping `/* */` block-comment regions.
- `resolve-block.ts` — longest path-segment-prefix match, file → owning block id; no match →
  `ROOT_BLOCK_ID` (`"(root)"`), never a silently dropped edge.
- `block-aggregate.ts` — `FileEdge[]` → `Edge[]`; only *crossing* file edges (source block ≠
  target block) survive; `importCount` = count of crossing file edges per block pair.
- `core/src/tsconfig-utils.ts` (new, shared) — JSONC-safe tsconfig reader, factored out of
  `blocks/workspaces.ts` (refactored to use it) so both call sites (project references here,
  path aliases in `depcruise-runner.ts`) share one parse-error-degrades-to-warning
  implementation instead of two independently-maintained copies.
- `core/src/path-utils.ts` (new, shared) — `isWithinRoot()`, a rootDir-containment predicate
  factored out of `blocks/fs-utils.ts`'s `toBlockRelativePath` (refactored to use it) so the
  same check guards `edges/file-graph.ts`'s resolved import targets and
  `edges/depcruise-runner.ts`'s alias targets — see bug 6 below for why this needed to be
  shared, not reimplemented.
- `analyze.ts` rewritten to orchestrate the full pipeline: `detectBlocks()` → run
  dependency-cruiser → build file graph → tally each block's real `fileCount` (walking
  `cruiseResult.modules`, filtered to real files) → conditionally append the synthetic
  `(root)` block (only if some file matched no detected block) → aggregate to block `Edge[]`.
  `AnalysisMeta.fileCount` is now the real total, not the Task-1/2 stub's honest `0`.
- Fixtures extended per `DIRECTORY-TREE.md`'s Task 2 note: `monorepo/` now has a root
  `tsconfig.json` aliasing `@c/*` into `packages/c/src/*` (an aliased **and** deep import, the
  latter doubling as Task 4's future boundary-violation fixture), a barrel import
  (`packages/b/src/index.ts` re-exporting `internal.ts`), and a genuine `b↔c` file-level
  import cycle. `flat-repo/`'s `api/index.ts` now imports `auth/index.ts` (one real
  cross-block edge on the flat-fallback detection path too).
- 52 new tests (124 total): `path-utils.test.ts`, `edges.depcruise-runner.test.ts`,
  `edges.file-graph.test.ts`, `edges.resolve-block.test.ts`, `edges.block-aggregate.test.ts`,
  `analyze.edges.test.ts`. All real-filesystem (temp dirs / checked-in fixtures / real
  `dependency-cruiser` calls), no mocks.

**Real-repo verification (ahead of Checkpoint A, informal):** ran `blocknet analyze --json`
against `aetherinc` (real Next.js app, 156 real files after fixing the bugs below) and
`aether-proxy` (single-file repo). `aether-proxy`: unchanged from Task 2 (zero blocks, root
catch-all, 1 file, real pills). `aetherinc`: 4 block edges (`src/app→src/components` ×63,
`src/components→src/lib` ×47, `src/app→src/lib` ×53, `(root)→src/lib` ×2), 233–252ms cold.
**10 file-level edges manually spot-checked** against the real source files, byte-for-byte —
all 10 matched exactly, including alias resolution (`@/lib/utils` → `src/lib/utils.ts`) and a
dynamic `import()`. `src/__tests__` and `src/data` still show `fileCount: 0` — confirmed
honest, not a bug: `src/__tests__` is a genuinely empty directory, `src/data` contains only a
`.json` file (not a scannable module extension) — both are instances of the already-tracked
flat-fallback-noise risk below, not new findings.

**Bugs found and fixed** (dependency-cruiser API behavior verified by direct testing before
writing any implementation code, per `CLAUDE.md`'s "no incremental shortcut without checking
it's actually correct" rule — none of the below were guessed at):
1. dependency-cruiser silently drops any import whose binding is never referenced in the
   importing file — TypeScript elides unused imports before dependency-cruiser's extractor
   ever sees them, unless `tsPreCompilationDeps: true` is passed. A real, present import that
   happens to be unused is still a real architectural dependency; the default behavior is a
   false negative. Fixed by always passing this option.
2. dependency-cruiser's `tsconfig-paths-webpack-plugin` resolves tsconfig `paths` relative to
   `process.cwd()`, not the `baseDir` cruise option — every aliased import would silently
   break whenever `analyze()` is invoked from a cwd other than the analyzed repo (the normal
   case for a forked worker process). Fixed by having `depcruise-runner.ts` read `paths` /
   `baseUrl` itself and hand enhanced-resolve an absolute-target `alias` map directly,
   bypassing dependency-cruiser's own tsconfig option entirely (now documented in ADR-0003).
3. If `rootDir` (or an ancestor) is a symlink — macOS's `os.tmpdir()` always is, so are some
   real dev setups — dependency-cruiser resolves dependencies through the realpath internally
   but leaves `baseDir` unresolved, so one real file gets reported as two different module
   entries under two different relative paths, splitting its edges across a "ghost" module
   that never resolves back to a block. Fixed via `realpathSync(rootDir)` before use.
4. The binding exclude list only named `node_modules`/`dist`/`build`/`out`/`coverage` — a
   real-repo run against `aetherinc` found `.next/`'s 345 generated files leaking into the
   graph as if they were source. Fixed by excluding *every* dot-directory categorically
   (regex, not an enumerated list) — this also brought `edges/` into agreement with
   `blocks/fs-utils.ts`'s `listChildDirectories`, which already excluded all dot-directories
   for block detection; before this fix the two halves of the pipeline silently disagreed
   about what counts as source.
5. `cruiseResult.modules` includes phantom entries for Node core-module imports (a bare
   `import fs from 'node:fs'` produces its own `{source: 'fs', coreModule: true}` module
   entry) and for unresolvable imports (`couldNotResolve: true`) — both were initially
   counted toward `meta.fileCount` and per-block `fileCount`, confirmed inflating real counts
   on `aetherinc` (`path`/`fs`/`url`/`module`/`child_process`/`crypto`/`stream` all leaked in
   as fake "files", and root's fileCount was 380 before this and the `.next` fix above,
   18 after). Fixed by filtering `!mod.couldNotResolve && !mod.coreModule` in `analyze.ts`.
6. **Path-containment escape, the same bug class Task 2 already fixed once for block
   detection, reappeared unguarded in edges/.** A plain relative import climbing out of
   `rootDir` (`../../outside/thing.ts` — ordinary when only a subdirectory of a larger
   monorepo is analyzed, the exact scenario Task 2's `PROGRESS.md` entry already names)
   resolved and would have leaked a `..`-prefixed path into `FileEdge.targetFile`, attributing
   a file outside the analyzed root to the `(root)` block. A tsconfig `paths` alias target
   resolving outside `rootDir` had the identical exposure. Both were, by coincidence, already
   blocked by finding 4's dot-directory exclude regex (`..` itself matches a dot-segment) —
   but that protection was incidental, not a documented guarantee, and would have silently
   stopped holding the moment that regex was ever tightened to stop matching bare `..`. Fixed
   properly: factored `blocks/fs-utils.ts`'s existing escape-check out into the new shared
   `core/src/path-utils.ts`, and wired it into both `file-graph.ts` (drops any dependency
   whose resolved path escapes rootDir) and `depcruise-runner.ts`'s alias derivation (skips
   any alias target that escapes rootDir, with a warning) — explicit and tested on both
   vectors, not riding on an unrelated regex's side effect.
7. `file-graph.ts`'s evidence-recovery line scan could misattribute evidence to a
   commented-out import inside a `/* ... */` block comment (a common refactor-in-progress
   pattern — no leading `*` required on continuation lines, so a stale import statement
   pasted into a block comment reads identically to a real one). Fixed by tracking
   block-comment state while scanning and skipping matches inside it.
8. `file-graph.ts`'s `readFileSync` for evidence lookup had no error handling — a file
   deleted or renamed between dependency-cruiser's scan and this read (a real race under the
   file-watcher-driven re-analysis this engine exists for, not a hypothetical one) crashed
   the whole `analyze()` call. Fixed to degrade to "skip this file's edges" with a logged
   warning, matching `blocks/`'s established never-crash convention.
9. `block-aggregate.ts` joined `${source}->${target}` as both the internal aggregation Map
   key and the public `Edge.id` — a block path can legally contain the literal substring
   `->` (directory names allow it), which could silently merge two genuinely different block
   pairs' `importCount`s into one (confirmed with a constructed test: blocks `"a->b"`+`"c"`
   vs `"a"`+`"b->c"` both stringify to `"a->b->c"`). Fixed the aggregation key to join on
   `\0` (cannot appear in any POSIX/Windows path component, a hard guarantee not a
   probability argument); `Edge.id` itself is left in the human-readable `->` form, since a
   *display*-id collision requires the same adversarial directory naming and this is a local
   tool analyzing the user's own trusted repo, not processing untrusted input.
10. A detected block whose real path happens to equal the `"(root)"` sentinel (legal, if
    bizarre, directory naming) would have produced a second, duplicate-`id` `BlockNode` when
    the synthetic catch-all was appended, and silently conflated that real block's own file
    count with unrelated orphan files' count (both resolve to the same map key once the id
    collides). Fixed: skip appending the synthetic block if a real detected block already
    claims that id — confirmed as a genuine regression (not a defensive no-op) by reverting
    the guard and watching the new test fail with a duplicate-id array before restoring it.

**Two-pass adversarial review done** (doc-consistency + architectural-soundness with an
explicit logic-consistency diff against existing sibling code, per `CLAUDE.md`'s ritual).
Doc-consistency pass found: ADR-0008 and `DIRECTORY-TREE.md` both still described the
original, narrower exclude list (fixed, both); `DIRECTORY-TREE.md` didn't mention
`tsconfig-utils.ts` at all and still listed a single `edges.test.ts` (fixed, matches the real
5-file split); the monorepo fixture note still said cycle/deep-import content was "not
present yet" (fixed); ADR-0005 said "`detect.ts` always appends" the root block, contradicted
by `detect.ts`'s own comment and the real `analyze.ts` implementation (fixed — the pipeline
appends it, `detect.ts` itself deliberately doesn't); judged the cwd-anchoring alias bug
(finding 2 above) as decision-level and promoted it into ADR-0003, judged the symlink/realpath
bug (finding 3) as correctly code-comment-only. Architectural-soundness pass found bugs 6-10
above, all fixed with a failing regression test written first (bug 10's fix was independently
confirmed by reverting it and watching the test fail). Two findings were checked and ruled
out, not fixed: `resolveBlock`'s O(files × blocks) linear scan is real but not a concern at
v1's stated 5k–50k-file scale with realistic (low-hundreds) block counts — adding an index
now would be exactly the unmeasured premature optimization `CLAUDE.md` prohibits; a tsconfig
`references` entry pointing at a dot-directory would produce a real but empty block, which is
the same already-tracked flat-fallback-noise risk class below, not a new gap.

### Checkpoint A — real-repo truth check (2026-07-19, in progress)

Ran `blocknet analyze` (read-only) against 4 real repos: `aetherinc` (156 files, flat Next.js
app), `aether-proxy` (1 file), `AetherArenaV2/aether-arena` (~4,627 files, real
`frontend`/`backend`/`desktop`/`open-connector` split, no root workspace manifest), and
BlockNet analyzing itself (npm workspace `["core"]`). Cold analysis time: 0.15s–5.2s across
that range — well inside the <60s budget even at real scale.

**Found:** `AetherArenaV2` collapsed to one meaningless `(root)` block with **zero edges** —
not noise, a total truth-gate failure on a real, actively-developed codebase. Root cause:
strategy 2 (`conventional.ts`, since deleted) was a hardcoded folder-name list
(`apps/packages/services/libs/infra`); none of `frontend/backend/desktop/open-connector`
matched, and there was no root workspaces field for strategy 1 either, so every strategy
correctly returned empty per its own narrow definition and the pipeline fell all the way to
`(root)`. This is exactly the failure mode ADR-0005's Consequences section named Checkpoint A
to catch.

**Fixed:** replaced the hardcoded strategy 2 with a generic structural host-detection walk
(`core/src/blocks/structural.ts`) — see the amendment in
[decisions/0005](../decisions/0005-blocks-auto-detected.md#amendment--2026-07-19-checkpoint-a)
for the full mechanism and rationale. Re-run: `AetherArenaV2` now yields 4 real blocks
(`frontend`:459, `desktop`:2, `open-connector`:4165, tiny `(root)`:1 — sums exactly to the
real 4,627-file total). Confirmed no regression on `aetherinc`, `aether-proxy`, or BlockNet
analyzing itself — all three produce identical results to before the fix.

**Two-pass adversarial review done** (doc-consistency + architectural-soundness with an
explicit logic-consistency diff against `workspaces.ts`/`flat-fallback.ts`, per `CLAUDE.md`'s
ritual). Doc-consistency pass found and fixed: a dangling "tracked below" cross-reference in
ADR-0005's amendment that named no file, and the ADR's `Date` field reading 2026-07-10 with no
signal that the Decision section's strategy-2 text was rewritten today (both fixed in the ADR
directly). Architectural-soundness pass found a real bug, confirmed with a failing regression
test written first: `structural.ts`'s depth cap bounds recursion *depth* but not *branching* —
two real directories with 30 symlinks each pointing at the other measured over **12 seconds**
(cost scales O(branching^4), independent of real file count; reproduced locally at
branching=40 taking 44.8s against a 3s test timeout, confirming RED before the fix). Fixed by
deduping the walk on real (symlink-resolved) path: once a real directory is visited via any
path, every other path to it — cyclic or not — is skipped before either a `package.json`
check or a recursive listing, capping total cost at the number of distinct real directories
reachable within the depth cap. Same pass also caught a real, *pre-existing* bug in
`pills.ts` widened in blast radius by this change: `derivePills` silently fell back to the
repo root's `package.json` when a block's own `package.json` existed but failed to parse —
misattributing an unrelated project's dependencies as this block's tech stack, worse than
showing none. `conventional.ts` only ever exposed this for directories under 5 named
top-level folders; `structural.ts` exposes it for any directory up to depth 4, a materially
larger surface nothing in the original fix re-examined. Fixed: a corrupt-but-existing
`package.json` now yields no pills rather than the root's unrelated ones; only a genuinely
*missing* `package.json` falls back to root (the flat-repo-strategy case this fallback exists
for). One existing test that encoded the old (wrong) behavior was corrected, not deleted.
12 new tests for `structural.ts` (11 from the original fix + 1 regression test for the
symlink-cycle cost bug), 2 existing `blocks.detect.test.ts` cascade-order tests updated for
the new strategy-2 semantics, 1 existing `blocks.pills.test.ts` test corrected. 128/128 tests
pass, build/typecheck/lint clean, all 4 real repos re-confirmed unchanged after both fixes.

**Known limitation at this point, resolved below:** `structural.ts` only recognized
`package.json` as a "host" signal, so a real non-JS/TS sub-project (like `AetherArenaV2`'s
own `backend/`, a genuine Python project) didn't become a block yet — correctly absent per
ADR-0004's TS/JS-only v1 scope, but explicitly requested as a follow-up (see the next entry).

### Multi-language block detection + generic fileCount (2026-07-19)

Explicitly requested: block detection and `fileCount` should reflect a repo's *whole* file
inventory, any language — a Python/Docker/Go sub-project sitting next to a TS/JS one is real
architecture, not something to hide because v1's import analysis is TS/JS-only. Landed in
three pieces: `core/src/file-walk.ts` (generic all-languages file walk, same exclude rules as
dependency-cruiser, shares `path-utils.ts`'s `EXCLUDE_PATTERN_SOURCE` so the two file
inventories can't drift), `analyze.ts` rewired to compute `fileCount` from it instead of
dependency-cruiser's TS/JS module list, and block detection widened to recognize non-JS
project manifests. `docs/decisions/0004` got a short clarification appended: TS/JS-only
governs import/edge/risk analysis, not block detection or fileCount — always true in intent,
worth saying explicitly now that the two are visibly decoupled.

**First attempt reverted after it broke a previously-passing real repo — recorded, not
dropped.** The first version widened `structural.ts`'s own recursive host search (4 levels
deep, per branch) to recognize a dozen manifest types. Re-running Checkpoint A's real-repo set
immediately found two new real bugs, not edge cases:
1. **Cascade hijacking.** `aetherinc` — previously 6 correct blocks via the flat-`src/`
   fallback — collapsed to 2, because a single incidental `pyproject.toml` found 4 levels deep
   inside `project/agent-skills/red-team-skills/constant-time-analysis/` (Claude Code tooling,
   unrelated to the actual Next.js app) made strategy 2 non-empty, and "first non-empty
   strategy wins" discarded the far more relevant flat-fallback result outright.
2. **Vendored build output counted as source.** Recognizing `Cargo.toml` as a host surfaced
   `AetherArenaV2/desktop`'s real Tauri/Rust project — whose `target/` build directory wasn't
   in `EXCLUDE_PATTERN_SOURCE` (JS-ecosystem names only). Measured: a `desktop` block with
   **131,144 files**, almost entirely Cargo build artifacts, not source.

**Both fixed architecturally, not patched:** `structural.ts` reverted to JS/TS-only
(`hasPackageJson`) — its recursive multi-level search stays scoped to what Checkpoint A
actually validated it for. Non-JS host detection moved to a new, deliberately shallow and
additive module (`core/src/blocks/other-languages.ts`): checks rootDir's own top-level
children *only* (no recursion) for a non-JS manifest not already covered by the base cascade,
and runs regardless of which base strategy won — so it can never preempt or replace a correct
result the way the reverted version could. `EXCLUDE_PATTERN_SOURCE` widened to also exclude
`target` (Rust/Maven), `__pycache__`/`venv` (Python), and `vendor` (Go/PHP/legacy JS) — the
same "every language's build/cache output gets excluded categorically" principle already
established for JS frameworks' dot-directories.

`pills.ts` also had to change: a block with a *different* language's manifest (no
`package.json` of its own) must not fall back to the repo root's `package.json` — that
fallback exists only for flat-fallback blocks with no manifest of any kind. Fixed the same
way as the earlier corrupt-JSON fix — distinguish "no manifest at all" from "a manifest, just
not this one" before ever falling back.

Re-validated against all 4 Checkpoint A real repos after both fixes: `aetherinc` back to 6
correct blocks (zero regression — the exact repo the false start broke), `AetherArenaV2`'s
`desktop` block back to a sane 122 files (from the pathological 131,144), and
`AetherArenaV2/backend` now correctly appears — 510 files, real Python content, 0 pills
(honest — not misattributed from the root's unrelated JS dependencies). New tests: 3 for
`file-walk.ts`'s exclude widening, 2 added to `structural.ts`'s suite for the reverted
JS/TS-only scope (git diff confirmed: 2 added, 0 removed — the original attempt's tests never
reached a committed state, so there's nothing to show as "removed" in history), 7 for the new
`other-languages.ts` module, 2 integration tests in `blocks.detect.test.ts` reproducing the
exact `aetherinc`-hijack and `AetherArenaV2`-shape scenarios end to end, plus
`analyze.edges.test.ts`'s existing fileCount expectations recomputed by hand and independently
verified against actual output (not just accepted from the code) before being updated.
158/158 tests pass, build/typecheck/lint clean.

### Round 2 adversarial review (2026-07-19) — two more real bugs found, both fixed

Re-ran the two-pass review from scratch on the multi-language work above, explicitly briefed
to find what was missed, not confirm the work looked reasonable. Doc-consistency pass found
two leftover artifacts of the reverted first attempt: `pills.ts`'s comment still attributed
non-JS host detection to "`structural.ts`'s widened host detection" (moved to
`other-languages.ts`), and `fs-utils.ts`'s `hasProjectManifest` was dead code (exported,
zero call sites) with a docstring falsely claiming `structural.ts` used it — both fixed
(comment corrected, dead function deleted), `DIRECTORY-TREE.md`'s matching false claim fixed
too.

Architectural-soundness pass found two real, more serious bugs, both confirmed by the
reviewer actually running the code, not just reading it:

1. **The `EXCLUDE_PATTERN_SOURCE` widening (`target`/`__pycache__`/`venv`/`vendor`) never
   reached block detection.** It was wired into `file-walk.ts` and `depcruise-runner.ts`, but
   `blocks/fs-utils.ts`'s `listChildDirectories` — the directory-traversal primitive
   `structural.ts`, `workspaces.ts`, `other-languages.ts`, and `flat-fallback.ts` all actually
   walk through — still only filtered dot-directories and the literal string `node_modules`.
   Reviewer reproduced directly: a `package.json` vendored inside `vendor/` (a real pattern —
   Composer-vendored JS asset pipelines, npm-pack output copied into `dist/`, wasm-pack's
   `target/pkg/package.json`) still produced a real, spurious block candidate, capable of
   hijacking the whole cascade exactly like the `pyproject.toml` bug this same day's earlier
   fix closed — just via a different manifest type. **This undercut the stated point of the
   exclude-pattern widening for the one thing it most needed to cover.** Fixed:
   `listChildDirectories` now filters through the same shared `isExcludedPath` predicate
   (tested against each entry's bare name — the pattern's `(^|/)...(/|$)` anchors make that
   equivalent to testing a full relative path, verified directly with a Node one-liner before
   relying on it). This closes the gap for all four block-detection strategies at once, and
   incidentally closes a latent gap that predated this whole round: `dist`/`build`/`out`/
   `coverage` were never excluded from block-detection's directory traversal either, only from
   the file/edge scan — just never manifested on any of the 4 Checkpoint A real repos.
2. **`file-walk.ts`'s real-path dedup only covered directories, not individual files.** A
   single physical file reachable via multiple symlinked *file* paths (a real pattern —
   Nx/Bazel-style tooling symlinking one shared config file into several package directories)
   was counted once per path. Reviewer reproduced: 3 entries for one real file. This directly
   contradicted this doc's own earlier claim that `walkRealFiles` has "the identical real-path
   dedup applied to the file walk itself... counts exactly once" — true for directories, false
   for files. Fixed: the same `alreadyVisited` check now gates the file-push branch too, not
   just the directory-recursion branch.

Also addressed, lower severity: `depcruise-runner.ts`'s import scan silently gained the same
widened exclude set as a side effect of sharing `EXCLUDE_PATTERN_SOURCE` — real, intentional,
documented, but untested until now; added a test confirming `target`/`vendor` content is
excluded from the actual dependency-cruiser module graph, not just `fileCount`. Added a test
for `other-languages.ts`'s sibling-prefix boundary (`backend` vs `backend-service`) — the
reviewer confirmed the existing slash-bounded prefix check already got this right (same
pattern `resolve-block.ts`'s `isPrefixMatch` uses), but it had zero test coverage before now.

**Checked and accepted, not fixed:** neither `file-walk.ts` nor `structural.ts` verifies a
symlink's resolved target stays under `rootDir` before recursing into it — only cycle
detection exists, which bounds *revisits* of the same real directory but not the size of a
single pathological external branch (a symlink pointing at `/` or `$HOME`, walked in full
modulo cycles). Not a path-leak (reported paths are built from the symlink's own location, not
its target) — an unbounded-cost risk for a symlink no real repo in the Checkpoint A set has.
v1's threat model is a user's own trusted repo, not adversarial input; revisit if a real repo
ever needs it.

Re-validated against all 4 real repos after every fix above: results stable, `fileCount`
dropped slightly where `vendor`/`target`/`venv`/`__pycache__` content was previously leaking
in (e.g. BlockNet's own `(root)`: 829 → 827). 162/162 tests pass, build/typecheck/lint clean.

**Checkpoint A signed off (2026-07-19).** Reviewed the real-repo block/edge results with
Krish across all 4 repos. The one open question — why `AetherArenaV2` and BlockNet-on-itself
show zero edges — was traced and confirmed architecturally correct, not a bug: `AetherArenaV2`
spans three separate language ecosystems (Rust `obscura`, Python `backend`, JS/TS
`frontend`/`open-connector`/`desktop`) with no workspace linkage and zero literal cross-block
import statements (grepped directly); BlockNet's own `(root)` block is almost entirely
`agent-skills/` tooling that never imports `core` or vice versa. `aetherinc`'s 4 real edges
were already byte-spot-checked in Task 3. Go. The already-tracked flat-`src/` fallback noise
(below) remains open, deferred past Checkpoint A by explicit choice, not an oversight.

### Task 4 — Risk checks: cycles + boundary ✅ (2026-07-19)
ADR: [decisions/0006](../decisions/0006-risk-checks-cycles-and-boundary.md) (amended this
task — see below). Built in `core/src/risks/`:
- `cycles.ts` — hand-rolled Tarjan SCC, deliberately **iterative**, not the textbook
  recursive formulation: a recursive DFS's stack depth tracks the longest import chain in the
  repo, not file count, and real repos build chains long enough to blow V8's default stack —
  the same class of "never checked against real-repo shape" mistake this session already hit
  once for `structural.ts`'s symlink walk. Proven safe with a 20,000-node linear-chain
  regression test (both acyclic, and separately closed into one giant cycle) — both complete
  in milliseconds. Always runs over the full file-level edge list, never incrementally scoped
  (decisions/0008).
- `boundary.ts` — deep-import-vs-declared-entry rule. "Declared entry" resolves `exports`
  (every string leaf, nested condition objects flattened) when present, else `main`, else the
  block's own conventional index file — checked at both `<block>/index.*` and
  `<block>/src/index.*`, not literally just the block root (see decisions/0006's amendment for
  why a block-root-only reading would misfire on nearly every real unbuilt TS/JS monorepo
  package). Each candidate is resolved to the real file on disk the same way TypeScript/
  dependency-cruiser would (literal path → source-extension swap → directory-index fallback).
- `index.ts` — runs both checks, groups file-level findings into `Risk[]` per directed block
  pair, attaches the winning risk to each block `Edge`. A pair can carry both tags at once;
  CIRCULAR wins the single `Edge.risk` slot (cycles are a hard graph fact, ~zero FP by
  construction; boundary's precision depends on the declared-entry definition) but both `Risk`
  objects always survive into the canonical `risks[]` array.
- `analyze.ts` wired in: retains the file-level edge graph (previously discarded immediately
  after block-aggregation) so risk checks have the granularity they need, computes each
  block's `riskCount` as the count of distinct risks touching it as source or target.
- `blocks/fs-utils.ts` gained a shared `readPackageJson` (pills.ts's private copy generalized
  and reused by boundary.ts — the same "same logic starts drifting into a second copy" pattern
  this session already fixed twice for other helpers).
- 33 new tests: `risks.cycles.test.ts` (9, incl. both 20k-node scale tests), `risks.boundary
  .test.ts` (15, incl. exports/main/conventional-index resolution and the real fixture spot
  check), `risks.index.test.ts` (5, incl. the both-tags-on-one-pair priority case),
  `analyze.risks.test.ts` (6, real fixture end-to-end + riskCount tallying + a clean-repo
  no-false-positive case). 200/200 total, build/typecheck/lint clean.

**Real bug found and fixed during Checkpoint-A re-validation, before this task could be
called done:** the first working version of `boundary.ts` flagged **100% of `aetherinc`'s
real crossing edges** (all 4) as BOUNDARY. Root cause: flat-fallback blocks (`src/app`,
`src/components`, `src/lib` — strategy 3, no `package.json` of any kind) have no real
"declared entry" concept at all, but the "no exports, no main" fallback tried to resolve a
conventional `index.ts` these directories were never meant to have, found none, and treated
every single import as a violation — the exact false-positive-on-sight failure
`docs/PRINCIPLES.md` treats as fatal, on a real Checkpoint-A repo, not a fixture. Fixed:
`findBoundaryViolations` now skips any target block that owns no `package.json` at all
(`hasPackageJson`, the same signal `workspaces.ts`/`structural.ts` already use) before ever
computing declared entries — a flat-fallback block is a directory grouping inside one
application, not a package with a designed public surface, so there's no real boundary to
violate. Re-verified against all 4 Checkpoint A real repos after the fix: 0 risks everywhere.
Full mechanism and rationale in decisions/0006's amendment.

**Honest limitation, not swept under the rug:** none of the 4 Checkpoint A real repos
currently exercises a true CIRCULAR or BOUNDARY positive — `aetherinc`'s only crossing edges
are into now-correctly-exempted flat-fallback blocks; `AetherArenaV2` and BlockNet-on-itself
have zero crossing edges of any kind (established above). The true-positive path is verified
by the checked-in monorepo fixture (byte-checked evidence: the exact `b↔c` cycle and `a→c`
deep import it was built for) and extensive synthetic unit tests, not yet by a real repo
naturally triggering one. Revisit if a future real repo does.

## Next up

Task 5 (cache + incremental invalidation, decisions/0008) is next, blocked on nothing but
itself. Checkpoint B (engine complete, `graph.json` schema frozen) follows once it's done.

## Deferred by design (not gaps)

- `extension/`, `.vscode/launch.json` — Checkpoint B gate ([LAYERS.md](../architecture/LAYERS.md)).
- `core/src/ipc-worker.ts` — arrives with Task 5.
- This directory is not yet a git repo (not requested; ready for one whenever asked).

## Tracked risks

- `typescript` pinned `^5.9.3` (not 6.x): tsup 8.5.1's DTS bundler breaks under TS 6.0's
  baseUrl-deprecation-as-error change. Dependabot has a matching `ignore` rule so a major
  bump doesn't land unreviewed — see CONTRIBUTING.md. Revisit when tsup fixes it upstream.
- **Flat-`src/` fallback produces noise on real repos** — confirmed on `aetherinc` (a real
  flat Next.js app): `src/__tests__` is detected as a block, which is not an architectural
  unit. This is the exact risk ADR-0005's Consequences section already names and assigns to
  Checkpoint A. Do not patch with a guessed exclude-list before Checkpoint A's real repo set
  is actually reviewed — an unvalidated heuristic here is the same mistake decisions/0008
  documents for incremental SCC scoping. Reconfirmed and sharpened by Task 3's real fileCount
  walk: `src/__tests__` is now visibly `fileCount: 0` (the directory is genuinely empty, not
  just noisy), and `src/data` is also `fileCount: 0` because it contains only a `.json` file
  — dependency-cruiser doesn't treat `.json` as a scannable module extension, so a
  legitimately-used data directory currently reads identically to a phantom empty one in the
  graph. Both symptoms of the same root cause; revisit together at Checkpoint A.
- `resolveBlock` (edges/resolve-block.ts) is an unindexed O(files × blocks) linear scan,
  called once per file (fileCount tally) and twice per FileEdge (block-aggregate). Checked
  during Task 3's review and ruled out as a v1 concern: at the stated 5k–50k-file scale with
  a realistic (low-hundreds) block count, this is single-digit milliseconds of string
  comparisons, not a real cost. No index added — `CLAUDE.md` prohibits optimizing without
  Checkpoint A measurement data, and there's no data yet suggesting this needs one.
- **RESOLVED (2026-07-19, see "Multi-language block detection + generic fileCount" above):**
  non-JS project manifests are now recognized via `other-languages.ts`, additively and
  top-level-only, and `fileCount` comes from a generic all-languages file walk. What remains,
  as a deliberate design trade-off rather than an oversight: `other-languages.ts` checks only
  rootDir's *immediate* children, never recursively — a non-JS sub-project nested more than
  one level deep (e.g. `services/backend-python/pyproject.toml`) won't be found, the same way
  `structural.ts`'s own JS/TS search needed up to 4 levels for `backend/packages/harness`.
  Not widened in this pass: the same cascade-hijacking failure mode that forced this module to
  be shallow in the first place would need a real architectural answer (e.g. depth-limited
  recursion that still can't preempt an already-resolved base cascade), not just raising a
  depth constant. No real repo in the Checkpoint A set has needed it yet.
- **Dual-discoverable directories (a real top-level directory AND a symlink to it that isn't
  hidden inside `node_modules`/a dot-directory) — fixed as a side effect of the symlink-cycle
  dedup fix above, verified empirically, not just inferred.** Originally suspected (before the
  dedup fix existed) to double-count into two separate blocks' fileCounts. Re-checked directly
  against the real pipeline (`structural.ts` + `depcruise-runner.ts` + `resolve-block.ts`)
  after the fix: only ONE of the two paths ever becomes a block candidate now (real-path
  dedup — whichever path the directory walk visits first "wins"; not fixed by name, so which
  literal path wins is filesystem-read-order-dependent and not guaranteed stable, but exactly
  one always wins, never both). The other path's files correctly fall through to `(root)`
  instead of fabricating a cross-block edge or double-counting into two blocks. **Update
  (2026-07-19):** `meta.fileCount`'s double-counting concern noted here is now also resolved
  as a side effect of `file-walk.ts` replacing dependency-cruiser's module list as
  `fileCount`'s source — `walkRealFiles` has the identical real-path dedup applied to the file
  walk itself (tested directly: a real directory + a separately-discoverable symlink alias to
  it counts exactly once). What's left, unrelated to `fileCount`: dependency-cruiser's own
  internal module list still walks both the real directory and the symlinked alias as separate
  physical files for *edge* purposes (`real-service/index.ts` and `symlinked-service/index.ts`
  are two distinct module entries even though they're the same bytes on disk) — a residual gap
  in edge detection, not file counting, living in `depcruise-runner.ts` and out of scope for
  this fix. Not hit on any of the 4 Checkpoint A real repos.
