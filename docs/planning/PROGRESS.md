# BlockNet v1 — Progress Tracker

Companion to [TASKS-V1.md](./TASKS-V1.md) — tracks what's *actually done* vs. that plan, so
work can resume cold without re-deriving context. Update this file as tasks complete. Do
not rewrite TASKS-V1.md/ROADMAP-V2.md themselves (`CLAUDE.md`).

## Status at a glance

| Phase | Status |
|---|---|
| Phase 1 — Engine (Tasks 1-5) | Tasks 1-5 done. |
| Checkpoint A (truth gate) | Signed off with Krish 2026-07-19 — see below. |
| Checkpoint B (engine complete) | Reached 2026-07-19 — see Task 5's entry. `graph.json` schema frozen. |
| Phase 2 — Extension (Tasks 6-9) | Tasks 6-9 done. Pending: real F5 manual verification (no VS Code GUI in the building environment — see Task 6's and Task 7's entries; interactive verification for Tasks 7-9 used a headless-browser (Playwright) session against a real dev server instead, not a substitute for a real extension host). |
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
- 39 new tests (after the two-pass review round below added its own): `risks.cycles.test.ts`
  (9, incl. both 20k-node scale tests), `risks.boundary.test.ts` (17, incl. exports/main/
  conventional-index resolution, the wildcard-subpath case, and the real fixture spot check),
  `risks.index.test.ts` (6, incl. the both-tags-on-one-pair priority case and a root-touching
  cycle), `analyze.risks.test.ts` (7, real fixture end-to-end + riskCount tallying + a
  clean-repo no-false-positive case + a root-touching-cycle no-dangling-reference proof).
  204/204 total, build/typecheck/lint clean.

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

**Two-pass adversarial review done** (doc-consistency + architectural-soundness, dispatched
as two independent, parallel background agents per `CLAUDE.md`'s ritual — neither saw the
other's output or the author's own reasoning). Two more real bugs found, both fixed:

1. **`boundary.ts` couldn't resolve `exports` wildcard subpaths (`"./*": "./src/*.ts"`)** — a
   mainstream real-world pattern for intentionally exposing an entire subtree, not an exotic
   shape. The wildcard leaf was collected as a literal string and handed to the same
   `existsSync`-based resolver as a normal path, which can never find a file with a literal
   `*` in it — every import through such a subpath was flagged BOUNDARY, a false positive on
   sight. Fixed: a leaf containing `*` is now compiled to a `RegExp` (Node's own semantics:
   `*` matches one-or-more characters, including further `/`s) and matched directly against
   the already-resolved `FileEdge.targetFile`, bypassing the filesystem-existence resolver
   entirely — there's no single real file to search for a wildcard leaf, the pattern itself
   is the full answer. 2 new tests (`risks.boundary.test.ts`): a wildcard match accepted, and
   a path outside the wildcard's scope still correctly flagged.
2. **`CIRCULAR` and `BOUNDARY` disagreed, silently, on whether the `"(root)"` synthetic block
   is ever excluded** — `boundary.ts` explicitly excludes it as a target (documented,
   deliberate), but `risks/index.ts`'s cross-block filter for `CIRCULAR` never did, and
   nothing said why not. Investigated rather than reflexively matched to boundary's
   exclusion: concluded the asymmetry is *correct*, not a bug — BOUNDARY is about a designed
   public surface, which root categorically has none of, but CIRCULAR is a raw graph fact
   (SCC membership) that doesn't care whether a file happens to be unclassified; hiding a
   real cycle because one of its files landed in `(root)` would misrepresent the truth this
   engine exists to report. Also directly disproved the reviewer's secondary "dangling
   reference" concern (a risk pointing at a `(root)` that was never appended as a
   `BlockNode`) with a full `analyze()`-pipeline test: any file whose edge resolves to
   `ROOT_BLOCK_ID` is, by construction, a file `walkRealFiles` also finds, which is exactly
   what flips `hasRootFiles` true and appends the block/Edge the risk attaches to — never
   dangling. Fixed by making the asymmetry explicit and documented (`risks/index.ts`'s header
   comment) rather than leaving it an unexamined gap, plus 2 new tests locking in the decision
   (`risks.index.test.ts`'s root-touching-cycle case, `analyze.risks.test.ts`'s end-to-end
   no-dangling-reference proof).

Also found and fixed by the doc-consistency lane: this very file claimed "33 new tests" in a
sentence whose own listed per-file breakdown summed to 35, not 33 — simple arithmetic error,
now corrected (and the total has since moved again to 204, from the two fixes above).

**Addendum (2026-07-20):** the two items above were narrated here as already fixed at the time
this section was first written, but the `boundary.ts`/`risks/index.ts` source changes had not
actually landed yet — only the tests had (RED, not GREEN): checked out that exact commit and
ran the suite directly, 265/267 passed, the 2 failures being precisely the new wildcard-subpath
cases this section describes. The source fix landed one commit later (`9dcfe25`), which also
fixed a related gap in the same resolver: `RESOLVABLE_EXTENSIONS` (and the matching strip
regex) was missing `.mts`/`.cts` — Node's native ESM/CJS TypeScript extensions, e.g. a real
`vite.config.mts` — the same gap `cache/manifest.ts`'s `SOURCE_EXTENSIONS` had (see Task 5's
entry). That commit also added `core/test/analyze.progress.test.ts` (asserting the CLI actually
emits `[blocks] n/4` / `[edges] n/4` / `[risks] n/4` / `[cache] n/4` progress lines before its
summary, not just that `onProgress` fires) and tightened `cli.test.ts`'s assertion on the same
output to match. All now GREEN and reflected in the 267/267 count above.

Everything else both lanes checked came back clean: the iterative Tarjan implementation was
independently cross-validated against a from-scratch recursive Kosaraju reference on
hand-built adversarial graphs (nested/adjacent SCCs, a high-in-degree hub, chorded cycles) and
at real scale (a 100,000-node linear chain, a 50,000-node/205,000-edge layered graph with 200
planted cycles, a 20,000-node graph with 500 planted SCCs) — zero mismatches, no stack
overflow, sub-100ms. `exports`/`main` edge cases (array-form exports, condition-only exports
with no `"."` key, an empty-string `main`, path-escape containment) were each independently
constructed and checked, not just read. `readPackageJson`'s extraction into `fs-utils.ts` was
confirmed behavior-preserving. Docs cross-checked line-by-line against the actual code
(ADR-0006's amendment, `DIRECTORY-TREE.md`'s `risks/`/`fs-utils.ts` entries), no dead code, no
hedge language, no broken cross-references.

204/204 tests pass, build/typecheck/lint clean after both fixes.

### Task 5 — Cache + incremental invalidation ✅ (2026-07-19)
ADR: [decisions/0008](../decisions/0008-caching-incremental-invalidation.md) (amended this
task — see its Amendment section for the three implementation-level decisions below). Built
in `core/src/cache/`:
- `manifest.ts` — builds a `CacheManifest`: per-file content hash, plus one `configHash`
  covering every `package.json`/`tsconfig.json` found anywhere in the tree (not just
  rootDir's own), so an alias map or `exports`/`main` change anywhere forces a full bust.
  A file outside TS/JS's resolvable extensions gets a constant placeholder hash instead of a
  real content read — see the real-repo bug below for why this isn't optional.
- `invalidate.ts` — `planInvalidation(previous, current)` diffs two manifests into one of
  five `InvalidationPlan` kinds, in a deliberate priority order (cold → config-changed →
  structural-changed → unchanged → content-changed), each stated in the module's header
  comment along with why the order can't be reordered.
- `store.ts` — persists the manifest, the last `GraphResult` snapshot, and the pre-
  aggregation `FileEdge[]` the delta path merges into, together in ONE JSON file (write-temp-
  then-rename), not three independently-atomic ones — seeded by a real correctness concern
  (a crash between two separate atomic writes could pair a fresh manifest with a stale
  snapshot and the mismatch would never self-heal), not just cleanliness.
- `analyze.ts` rewritten to branch on the invalidation plan: `unchanged` returns the cached
  snapshot verbatim (near-instant); `content-changed` re-cruises only the modified files
  (`edges/depcruise-runner.ts` gained an optional `entryFiles` parameter for this — verified
  by direct testing that dependency-cruiser transitively expands from a scoped entry rather
  than reporting only that one file, so the caller filters the result to just the modified
  files' own edges, matching this project's established "verify dependency-cruiser behavior
  before relying on it" discipline) and splices the result into the cached file-edge graph;
  everything else (cold, config-changed, structural-changed) runs the full pipeline unchanged
  and writes a fresh cache. Tarjan/CIRCULAR always runs over the full merged edge list on
  every path, per the ADR — never incrementally scoped. Manifest-building (and therefore all
  cache work) is fully skipped when `cacheDir` isn't passed at all — a CLI/CI call with no
  `--cache-dir` pays none of the hashing cost.
- 49 new tests: `cache.manifest.test.ts` (15), `cache.store.test.ts` (10),
  `cache.invalidate.test.ts` (10), `analyze.cache.test.ts` (11, end-to-end on a mutated temp
  repo — cold start, unchanged-is-a-cache-hit-and-measurably-faster, content-changed edge
  add/remove, config-change bust, structural add/remove bust), 2 added to
  `edges.depcruise-runner.test.ts` for the new scoped-entry-files behavior, and 1 added to
  `risks.boundary.test.ts` for the `.mts`/`.cts` fix below. 256/256 total, build/typecheck/
  lint clean.

**Real bug found and fixed during real-repo validation, before this task could be called
done:** the first working version of `manifest.ts` read every real file's full content to
hash it (`readFileSync(path, 'utf-8')`), needed to detect which files changed for the delta
path. Re-running the Checkpoint A real-repo validation loop (mandatory after any change
touching analysis behavior) found `aetherinc` had grown a 504MB checked-in Docker image
archive and two 69MB PDFs since Task 3 — reading all of it turned a claimed near-instant
warm-cache run into ~10.1 seconds, on every single call, cache hit or not, since the
`unchanged` fast path still has to hash every file to *know* nothing changed. Root cause:
a non-TS/JS file's content can never produce or change a `FileEdge` (import/edge analysis is
TS/JS-only, decisions/0004) — only its *existence* matters, already tracked via the
manifest's key set regardless of what hash value is stored for it. Fixed: `manifest.ts` only
reads real content for `package.json`/`tsconfig.json` and files matching a
`SOURCE_EXTENSIONS` set mirroring `risks/boundary.ts`'s `RESOLVABLE_EXTENSIONS`; every other
file gets a constant, content-independent placeholder hash, so its bytes are never read
regardless of size.

**Two-pass adversarial review done** (doc-consistency + architectural-soundness, dispatched
as two independent, parallel background agents per `CLAUDE.md`'s ritual). Four more real
issues found, all fixed:
1. **`.mts`/`.cts` were missing from both `manifest.ts`'s `SOURCE_EXTENSIONS` and
   `risks/boundary.ts`'s pre-existing `RESOLVABLE_EXTENSIONS`** — dependency-cruiser parses
   both as TS-compatible (`tsPreCompilationDeps: true`), so a real edit inside, say, a
   `vite.config.mts` was silently misclassified as a non-source change: its hash never
   moved, `planInvalidation` never saw it as dirty, and the cache would have served stale
   edges/risks indefinitely. Confirmed by direct reproduction (reviewer built and ran a
   script proving the stale-serve). Fixed both extension lists, plus `boundary.ts`'s
   extension-strip regex in `resolveDeclaredPath`; 1 regression test added to each of
   `cache.manifest.test.ts` and `risks.boundary.test.ts`.
2. **The content-changed merge in `analyze.ts` used `Array.includes()` instead of a `Set`**
   to filter cached edges against the modified-files list — O(cachedEdges × modifiedFiles)
   instead of O(cachedEdges). Benchmarked by the reviewer: 300k edges / 5k modified files =
   3.68s with `.includes()` vs 19ms with `Set.has()`. A repo-wide reformat or branch switch
   on a real 50k-file repo could plausibly hit this scale, which would have made the
   "instant delta" path slower than the full cold scan it exists to replace. Fixed: the
   merge now builds a `Set` once per call.
3. **`analyze.ts` built a full `CacheManifest` (hashing every content-relevant file)
   unconditionally, even when `cacheDir` was never passed** — directly contradicting the
   function's own header comment ("no cacheDir at all → today's plain full scan, unchanged,
   never cached"). A CLI/CI caller that never passes `--cache-dir` was paying the full
   hashing cost for a manifest nothing would ever read or write. Fixed: manifest-building
   (and the invalidation plan) is now gated behind `options.cacheDir !== undefined`.
4. **`CacheManifest.files[path].blockId` was computed (via `resolveBlock`) but read by
   nothing** — not `invalidate.ts`, not `store.ts`, not `analyze.ts` on cache read-back.
   Computing it doubled `resolveBlock`'s already-flagged O(files×blocks) cost per full scan
   for a field with zero consumers. Since `CacheManifest` is a purely internal cache-file
   format (unlike `GraphResult`, nothing outside `core/cache`/`analyze.ts` depends on its
   shape), removing the unused field was the more disciplined fix than wiring it to a
   speculative future consumer — `types.ts`'s `CacheManifest` no longer has a `blockId`
   field, and `buildManifest()` no longer takes a `blocks` parameter at all.

Also corrected in the same pass: `AnalyzeOptions.changedFiles`'s docstring falsely implied
`cache/invalidate.ts` reads it — it doesn't; Task 5's invalidation is entirely
manifest-diff-based, by deliberate design (ADR-0008: "the manifest ... used to decide what,
if anything, is now stale"), not a caller-supplied hint. Comment corrected to say the field
is reserved for Task 6's watcher integration and currently unread, with the "should a
watcher hint let analyze() skip hashing the full tree" question left open rather than
guessed at now. `docs/planning/PROGRESS.md`'s own "Deferred by design" section (below) had
said `core/src/ipc-worker.ts` "arrives with Task 5" — wrong; it's Task 6's
`child_process.fork()` entrypoint, bundled there with progress-message wiring and
`analysis-runner.ts` as one coherent unit (`docs/architecture/PROCESS-BOUNDARY.md`). Fixed
below.

Re-verified against all 4 Checkpoint A real repos after every fix above (read-only `analyze`
runs only — no repo was mutated): `aetherinc` (1,025 files) no-cacheDir ~287ms, cold-with-
cacheDir ~195ms, warm (unchanged) ~38ms; `AetherArenaV2` (6,550 files) no-cacheDir ~5.4s,
cold ~4.0s, warm ~246ms; `aether-proxy` and BlockNet-on-itself both correspondingly fast.
Block/edge/risk counts identical across all three modes on every repo — none of these fixes
changed *what* gets computed, only *when* work is skipped or how efficiently it's merged.

Everything else both lanes checked came back clean: multi-window write-temp-then-rename
atomicity was stress-tested empirically (3 concurrent processes × 500 writes + a concurrent
reader looping for 3s — zero torn reads, zero corrupt state); `entryFiles` scoping confirmed
cwd-independent (dependency-cruiser resolves entry paths via `baseDir`, not `process.cwd()`);
a renamed/moved file was confirmed to always land in `structural-changed` (full bust), never
the scoped delta path; hash oscillation (edit-then-undo) was confirmed to have no stuck-state
risk since each run only diffs against the immediately-prior manifest; the removed-import
case was confirmed correct (old edges for a modified source are wholly replaced, not merged
additively); all doc cross-links resolved and no hedge language was found in any touched
ground-truth doc.

256/256 tests pass, build/typecheck/lint clean after all fixes.

## Checkpoint B — engine complete (2026-07-19)

The public `graph.json` schema (`GraphResult`/`BlockNode`/`Edge`/`Risk`/`AnalysisMeta`) is
frozen as of Task 5 — none of these types changed to build caching. `types.ts`'s internal,
cache-only `CacheManifest` type did change (its unused `blockId` field was removed during
this task's own adversarial review, before ever shipping to a consumer — see above), and
`AnalyzeOptions.changedFiles`'s docstring was corrected — neither is part of the frozen
public surface extension/webview code will ever consume. All core tests pass (256/256), the
CLI is honest, fast, and incremental on real repos (measured above, not asserted). Per
`CLAUDE.md`'s "No UI before the truth gate," `extension/` may now begin — Task 6 is next.

### Task 6 — Extension host: activation, forked child process, progress, cache wiring ✅ (2026-07-20)

**What shipped.** `core/src/ipc-worker.ts` (thin `child_process.fork()` adapter over
`analyze()`, structured `process.send({type:'progress'|'result'|'error', ...})`, one-shot —
waits to be killed rather than self-exiting). `analyze()` itself now actually calls
`onProgress` at all four phase boundaries (`blocks`/`edges`/`risks`/`cache`, matching
`FLOWS.md`'s "progress(blocks,1/4)...(cache,4/4)" diagram exactly) — previously declared in
`types.ts` but never invoked; this was a real, previously-undetected gap, not new scope.
`extension/` now exists as an npm workspace (`@blocknet/extension`) with: `analysis-runner.ts`
(fork lifecycle + monotonic generation-id tagging/superseding, `FLOWS.md` §2a),
`cache-bridge.ts` (`context.storageUri` → cache dir), `change-buffer.ts` + `watcher.ts`
(debounced ~500ms file-system watcher, config/structural/content classification per
decisions/0008's priority order), `panel.ts` (WebviewPanel lifecycle + a placeholder body),
`extension.ts` (lazy activation) and `commands/show-architecture.ts` (the command itself).
Root `package.json`'s `workspaces` now lists `["core", "extension"]`.

**Deliberately out of scope for this task** (not gaps — named here so no one "completes"
Task 6 by silently building ahead into a later task's territory):
- The real webview (`extension/webview/`, React Flow, `BlockCanvas.tsx`, design tokens) is
  Task 7's. `panel.ts` ships a minimal inline-HTML placeholder (progress text + a raw JSON
  dump) that proves the `postMessage` wiring end to end — Task 7 replaces its body wholesale,
  not incrementally.
- `state.ts` (workspaceState position persistence) is Task 8's. `git.ts` and
  `commands/open-file.ts` are Task 9's. None of the three existed at Task 6 time — all three
  are now built; see Task 8's and Task 9's own entries below.
- The no-workspace / multi-root-workspace degrade states render as static bodies chosen at
  panel-creation time (`panel.ts`'s `PanelState`), not the real `EmptyState.tsx` component
  Tasks 7–8 own — a deliberate, temporary stand-in so `ENGINEERING-CONSTRAINTS.md`'s "never an
  error toast" rule is honored now rather than deferred along with the rest of the webview.
- `AnalyzeOptions.changedFiles` is still not read by `analyze()`. `watcher.ts` passes it
  through anyway on pure-content-edit triggers (empty array or populated, never on a
  config/structural trigger) so its shape matches `FLOWS.md`'s diagram and needs no rewrite
  the day core starts reading it — but core's own cache/invalidate.ts self-detects the real
  classification via content hashing regardless, so this remains a no-op today, not a
  half-wired optimization.

**Real bugs/gaps found and fixed while building this** (each cost real debugging time, kept
here so the next person touching this wiring doesn't rediscover them from scratch):
1. **`analyze()` never actually called `onProgress`** despite `Progress`/`onProgress` existing
   in `types.ts` since Task 5 — a real, previously-shipped gap, not something this task
   introduced. Fixed with tests first (`core/test/analyze.progress.test.ts`): all four phases
   fire in order for a full/cold/content-changed run; zero events fire for an unchanged cache
   hit (matching "no re-analysis of any kind" — firing synthetic progress for work that didn't
   happen would be dishonest telemetry).
2. **`require()`-ing `@blocknet/core`'s ESM barrel from a CJS bundle throws
   `ERR_REQUIRE_ASYNC_MODULE`** — `dependency-cruiser` has genuine top-level `await` in some
   of its own source files. Confirmed directly (`node -e "require('./core/dist/index.js')"`).
   Fixed by giving `path-utils.ts` (zero imports of its own) a dedicated
   `@blocknet/core/path-utils` export, decoupled from `analyze.ts`'s dependency-cruiser graph
   — `watcher.ts` imports `isExcludedPath` from there, not the main barrel. See
   `core/src/index.ts`'s header comment and decisions/0011's 2026-07-20 amendment.
3. **esbuild cannot lower dependency-cruiser's top-level `await` into a CJS *or* re-bundled
   ESM output either** (a second, unrelated esbuild-specific resolution failure surfaced on
   the ESM attempt — a deep import inside one of dependency-cruiser's optional integrations
   that tsup's bundler already tolerates). Fixed by not re-bundling `ipc-worker.ts` at all:
   `extension/esbuild.config.ts` copies `core/dist/ipc-worker.js` (already built by tsup)
   verbatim into `extension/dist/ipc-worker.mjs`.
4. **That copy silently broke a second time** because `core/tsup.config.ts`'s default
   multi-entry behavior shares code across entries via an separate chunk file — copying
   `ipc-worker.js` alone left it importing a sibling chunk that never made the trip
   (`ERR_MODULE_NOT_FOUND` at `fork()` time, not build time). Fixed with `splitting: false`.
5. **`AnalysisRunner` computing its worker path from its own `__dirname` only resolves
   correctly once bundled into `extension/dist/`** — a unit test importing the TS source
   directly (unbundled) gets `__dirname` = `src/`, not `dist/`, so `fork()` silently pointed
   at a nonexistent file and every run "succeeded" into an `error` outcome. Fixed by making
   `AnalysisRunner` take `workerPath` as a constructor parameter instead — `extension.ts` (the
   only real caller, living in the same bundle) resolves it from its own `__dirname`; tests
   pass the real built path directly. This is also just a better design independent of the
   bug it fixed: `AnalysisRunner` is now fully unit-testable against the real forked worker.
6. **Statically importing the real `vscode` module in a file loaded outside a real extension
   host throws** (`Cannot find package 'vscode'` — there is no runtime shim, only
   `@types/vscode`'s ambient types). Fixed by splitting the pure debounce/classification
   logic into `change-buffer.ts` (no `vscode` import at all) from `watcher.ts`'s thin
   `FileWatcher` shell — the same pattern already applied to `analysis-runner.ts` and
   `cache-bridge.ts`, which turned out not to need `vscode` at all despite `LAYERS.md`
   originally assuming the whole layer did (corrected there).
7. VS Code auto-generates the `onCommand:blocknet.showArchitecture` activation event from
   `contributes.commands` at the engines.vscode floor this extension targets — confirmed via
   the editor's own manifest lint, not assumed. Declaring it explicitly was flagged as
   redundant; removed from `package.json`, corrected in `ENGINEERING-CONSTRAINTS.md`.

**Verification actually performed:** `sh .githooks/pre-push` green across both workspaces —
core 267/267 tests, extension 19/19 tests, build/typecheck/lint clean. `AnalysisRunner`'s and
`ipc-worker.ts`'s tests fork the real built worker (black-box, mirroring `cli.test.ts`'s own
posture) — not mocked. **Not performed: a real F5 extension-development-host manual run.**
This session's environment has no VS Code CLI/GUI available (`code --version` fails, no
display) — Task 6's own acceptance criteria specifically call for "manual run on a real repo
via F5 extension dev host," and that step is honestly outstanding, not silently skipped or
falsely claimed. `.vscode/launch.json` + `.vscode/tasks.json` (a `build-extension` task,
explicit rather than relying on VS Code's auto-detected npm-task naming) are in place for
whoever runs it next: open the repo in VS Code, press F5, confirm the command shows up, a
real repo's progress messages stream in, the placeholder body updates, and editing a file
triggers a second push — Task 6's three literal acceptance criteria.

256 core tests → **267/267** (11 new: 5 progress-wiring + 5 ipc-worker fork/IPC + 1 cli.test.ts
assertion updated to match real progress output preceding the summary line, which is new,
correct behavior, not a regression). Extension: **20/20** (10 `change-buffer.test.ts` + 8
`analysis-runner.test.ts` + 2 `cache-bridge.test.ts` — 8, not 7, after the review's fix below
added a regression test).

**Two-pass adversarial review (2026-07-20): run, findings reconciled, fixes applied.**

Doc-consistency pass found 3 minor issues, all fixed: (1) `types.ts`'s `changedFiles`
docstring still called the read/don't-read question "open... for Task 6" after Task 6 had
already shipped without resolving it — reworded to reflect that Task 6 shipped the
watcher-populated-but-unread state and left the question open past Task 6, not within it; (2)
`DIRECTORY-TREE.md` dropped the `**/` glob prefix on `workspaceContains:**/tsconfig.json` in
one comment; (3) `.vscode/tasks.json` (the `build-extension` task `launch.json`'s
`preLaunchTask` depends on) existed on disk and was named in this very entry but wasn't listed
in `DIRECTORY-TREE.md`'s root `.vscode/` section. The pass also verified, by actually
building/running rather than reading: core's type-only `WorkerMessage`/`WorkerRequest`
re-export truly erases at build time (compiled `dist/index.js` has no runtime import of
`ipc-worker.js`), and all seven claimed bug-fix numbers and both test-count claims were
byte-accurate against a real `pre-push` run.

Architectural-soundness pass found **one real bug**: `AnalysisRunner.run()`'s `onProgress`
callback fired unconditionally for every progress message, gated only the *terminal*
outcome against `isLatest()` — never the in-flight progress stream. Confirmed with a real
repro (two overlapping forked runs against a real repo, no mocks): the older, superseded
run's late `cache 4/4` progress event arrived *after* the newer run's `graph/macro` had
already rendered "Analysis complete," silently overwriting the panel's status back to
"Analyzing…" with nothing left to correct it — a direct violation of `FLOWS.md` §2a's own
stated guarantee that "the webview never regresses to older data because an older analysis
happened to finish last." **Fixed**: `AnalysisRunner.run()` now gates the `onProgress` call
itself against `isLatest(generation)`, the same check the terminal outcome already used —
centralizing the invariant in the one class that owns generation state, rather than trusting
every future caller to remember to gate progress manually. Regression test added
(`analysis-runner.test.ts`: "never delivers onProgress for a run superseded by a newer one
before it started") — confirmed RED against the pre-fix code, GREEN after.

The same pass also flagged one **defensible tradeoff** (checked and ruled out as a live bug,
worth remembering if ever revisited): `fork(..., {stdio:'pipe'})` never consumes the child's
stdout/stderr, a classic footgun if the child ever writes enough to itself to matter — stress-
tested directly (a synthetic 20MB write under the same setup still delivered its IPC message
in ~38ms; Node buffers non-blocking pipe I/O in-process rather than hanging the event loop),
and `dependency-cruiser` (the only dependency with meaningful output volume inside `analyze()`)
has zero `console.*` calls, so this isn't live today. A defensive `child.stdout?.resume()` /
`.stderr?.resume()` would be cheap insurance if this class is ever extended to run something
noisier. Also took the pass's two "very minor, not independently actionable" UX notes anyway
since the fix was trivial and free: `commands/show-architecture.ts` now logs the full
`analyze()` failure (including stack trace) to the console but only shows the toast's first
line, and the outer `.catch()` path is now `isLatest()`-gated too, matching the `.then()` path
for consistency (the reviewer confirmed this specific path isn't reachable in practice, but
gating it costs nothing and removes an asymmetry a future reader would have to notice was
deliberate).

Concurrency/lifecycle correctness the pass explicitly verified by *running* real code, not
just reading it (recorded here so it isn't re-litigated from scratch next time this wiring is
touched): generation ordering holds correctly regardless of which of two overlapping runs
finishes first (the generation counter increments synchronously, no `await` between
assignment and use, so no interleaving window exists); a worker killed mid-flight
(`SIGKILL` sent 5ms after fork) still resolves its promise immediately via the `'exit'`
handler, never hangs; `change-buffer.ts`'s `Set`-based dedup and config/structural/content
priority order was checked directly against `cache/invalidate.ts`'s own priority order and
does not diverge in any way that affects `analyze()`'s actual behavior (which doesn't read
`changedFiles` regardless); `watcher.ts`'s `toPosixRelative` (using `node:path`'s
platform-dynamic `sep`) is actually slightly more correct cross-platform than two existing
analogous helpers elsewhere in `core/` that hardcode a literal backslash split — noted as a
pre-existing minor drift in `core/`, not a Task 6 regression, and not fixed here since it's
out of this task's scope.

### Task 7 — Webview: React Flow macro graph with prototype fidelity ✅ (2026-07-20)

ADR: [decisions/0007](../decisions/0007-react-flow-blocks-not-clouds.md). New npm workspace
`extension/webview` (`@blocknet/webview`, its own `package.json` — added as a third root
workspace member, not folded into `@blocknet/extension`). Scaffolded with `npm create vite@latest`
(TASKS-V1.md's own suggested build order: use the ecosystem's own tooling), then the demo
boilerplate stripped and replaced entirely; `tsconfig.app.json`/`tsconfig.node.json` extend
`tsconfig.base.json` rather than duplicating it, and the root `eslint.config.js` gained a
`react-hooks` block scoped to `extension/webview/src|test/**` — no per-package lint config
(REPO-STANDARDS.md).

**What got built**, per `docs/architecture/DIRECTORY-TREE.md`'s webview section (rewritten
this task to match what actually landed, not the pre-Task-7 sketch):
- `flow/BlockCard.tsx` — pure presentational card (status dot, `N× ⚠` risk pill, path, tech
  pills, and the **connection-count badge**, new beyond the design reference per Task 7's own
  acceptance criteria) with no React Flow dependency, so it's unit-testable standalone. An
  `interactive` prop suppresses its own `role`/`tabIndex`/keyboard handling when RF's own node
  wrapper — confirmed by reading `@xyflow/react`'s source, not assumed — already provides all
  three, avoiding a nested-interactive-element accessibility anti-pattern (two tab stops for
  one visual card).
- `flow/BlockNode.tsx` — the thin RF `NodeProps` adapter: invisible `Handle` anchors (the
  visible port dot is drawn by `RiskEdge.tsx` itself, matching the design reference's own
  SVG-drawn ports) plus `BlockCard` with `interactive={false}`.
- `flow/edge-path.ts` + `flow/RiskEdge.tsx` — `edge-path.ts` is an exact port of the design
  reference's own `pathOf()` (`design_handoff_blocknet_extension/BlockNet.dc.html`), not RF's
  generic `getBezierPath`, because visual parity depends on that specific curvature (control
  points floored at 52px). `RiskEdge.tsx` renders it via RF's `BaseEdge` (which already
  provides the wide invisible interaction path the design reference builds by hand) plus port
  circles and a `!` risk badge at the true midpoint.
- `flow/layout.ts` — dagre, left-to-right rank flow (matches the output-right/input-left port
  convention). Runs on every hydration for now; Task 8 scopes it to `BlockNode` ids absent
  from a persisted positions map.
- `flow/graph-derive.ts` — `relatedIds()` (selection→dimming, mirrors the design reference's
  `relatedSet()` exactly) and `connectionCounts()` (the new badge's data).
- `flow/block-label.ts` — one accessible-name function shared by `BlockCard`'s standalone
  mode and `BlockCanvas.tsx`'s `node.ariaLabel`, so the two never drift.
- `flow/BlockCanvas.tsx` — the RF root: `fitView` (see bug 6 below), pan/zoom clamp
  `k∈[0.3,2.4]`, click-to-select with dimming on both nodes and edges, RF's own `<Background
  variant="dots">` and `<Panel>` used for the grid and the zoom-control overlay instead of
  hand-rolling either.
- `ui/StatusBar.tsx`, `ui/ZoomControls.tsx` — brand/legend/live risk count; custom-styled
  −/percent/+/reset control.
- `theme/tokens.css` — design tokens (`docs/planning/TASKS-V1.md`'s Design Tokens section) as
  semantic custom properties resolving through `var(--vscode-*, prototype-dark-fallback)` —
  confirmed against VS Code's own webview API docs that it stamps `body.vscode-light` /
  `-dark` / `-high-contrast` / `-high-contrast-light` and exposes `var(--vscode-*)` theme
  colors, rather than assumed. Card gradients are derived via `color-mix()` from a single
  `--vscode-editorWidget-background` value (not two hardcoded stops), so they adapt correctly
  in both directions instead of just working for the prototype's one dark palette. A
  `body.vscode-high-contrast` override forces a real border on every card (see bug 6's
  screenshot verification) — a card whose only affordance was a soft `box-shadow` is exactly
  the WCAG 1.4.11 non-text-contrast failure that would otherwise ship.
- `fixtures/sample-graph.ts` (5 blocks exercising a real CIRCULAR cycle, a BOUNDARY
  deep-import, and a risk-free edge all at once) and `fixtures/stress-graph.ts` (generated
  30-block/100-edge fixture — Task 7's stated scale target, reachable in the built app via a
  `?stress=1` dev/QA query param).
- Self-hosted fonts: Google's `css2` API serves one **variable-font** woff2 per family across
  the whole declared weight range (`400 700` etc.), not one static file per weight — verified
  by inspecting the actual response rather than assumed, which cut the font payload from a
  presumed 7 files down to 2 real ones.
- `extension/src/webview-html.ts` (new, vscode-free, unit-tested) + `panel.ts` rewritten to
  serve the real built app: reads `webview/dist/index.html`, injects a `<base>` tag + strict
  CSP meta + a nonce on the built `<script>` tag, with `localResourceRoots` scoped to
  `webview/dist/`. Falls back to a friendly in-panel message (never a blank panel) if the
  webview bundle wasn't built — the same reasoning `AnalysisRunner` taking `workerPath` as a
  parameter already established: a build-time check doesn't help someone who edits `src` and
  reloads without rebuilding.

**Verification actually performed:** `sh .githooks/pre-push` green across all three
workspaces — core 267/267 (unchanged, 27 files), extension 26/26 (4 files, +5 for
`webview-html.test.ts`, +1 from the review round below), webview 41/41 (6 files, new, +1 from
the review round below), build/typecheck/lint clean. Production `vite build` produces a
~459 KB JS bundle (~145 KB gzip — the exact byte count moves a little build to build and isn't
pinned here for that reason; noted, not yet measured against a hard budget since none is
documented; not egregious for a webview that loads once per panel open, not per keystroke).
**Real visual verification, not just passing tests**: a headless Chromium instance
(Playwright, system binary — not bundled as a repo dependency, a one-off verification tool)
screenshotted the built app served via `vite preview` against the original design reference
(`BlockNet.dc.html`) side-by-side, plus simulated VS Code light and high-contrast themes
(representative `--vscode-*` values injected, since no real VS Code GUI
exists in this environment) and the 30-block/100-edge stress fixture. Confirmed genuine visual
parity: gradient cards, status dots, risk pills, tech pills, bezier ports, dashed/pulsing
edges with the `!` badge, status bar, legend, and zoom controls all match closely; the
connection-count badge (new) and the light/high-contrast adaptations (also new, the prototype
is dark-only) render correctly. **Not performed**: a real F5 extension-development-host
manual run (same environment gap as Task 6) and empirical interaction-smoothness/FPS
profiling at the 30-block/100-edge scale — the stress screenshot confirms a clean, legible,
non-overlapping static render at that scale, not measured frame timing under drag/pan.

**Seven real bugs found and fixed during construction** (TDD'd where the fix was logic, not
tooling; all confirmed by reproducing directly, not assumed):

1. **A poisoned `package-lock.json` silently prevented `@vitejs/plugin-react` from ever being
   materialized to disk**, despite `npm install` reporting success and the package being
   correctly listed in the lockfile's resolved tree. Traced through `npm --loglevel silly`:
   the package appeared in the audit request but never received a `reify`/`ADD` action from
   two consecutive earlier failed installs (an `ERESOLVE` on a since-removed `eslint-plugin-
   jsx-a11y` addition, an `ETARGET` on a wrong guessed version for
   `@testing-library/jest-dom`) leaving inconsistent state. Fixed by a full clean reinstall
   (`rm -rf node_modules package-lock.json && npm install`); confirmed the same package
   installs correctly in total isolation, ruling out a real npm/registry defect.
2. **jsdom has no `ResizeObserver`, and React Flow's node-measurement pipeline waits for its
   callback before making a node visible or routing any edge to it** — confirmed by reading
   `@xyflow/system`'s source (`updateNodeInternals` reads `offsetWidth`/`offsetHeight`/
   `getBoundingClientRect()` on the real DOM node, not the observer entry's own payload).
   Unmocked, this isn't a crash — every node just silently stays `visibility: hidden` and
   every edge renders zero, which reads exactly like "the component doesn't render edges"
   unless traced to the actual cause. Fixed with a `ResizeObserver` stub plus mocked
   `offsetWidth`/`offsetHeight`/`getBoundingClientRect()`.
3. **jsdom also has no `DOMMatrixReadOnly`**, thrown from inside `@xyflow/system`'s own
   viewport-transform math. A minimal stand-in covering only the fields RF actually reads.
4. **`happy-dom` was tried as a jsdom alternative** (it advertises native support for both
   gaps above) but broke the `document` global entirely in this exact toolchain — every
   `render()` call failed with "document is not defined." Reverted to jsdom + the targeted
   polyfills above rather than chasing an unrelated regression in a different direction.
5. **`userEvent.click()` on any React-Flow-rendered node or the pane throws an unhandled
   async error** — RF's pane and draggable nodes attach native (non-React) d3-drag/d3-zoom
   `mousedown` listeners for real dragging, and d3-drag's `nodrag()` unconditionally reads
   `event.view.document`; jsdom's `MouseEvent` leaves `view` null unless a caller sets it
   explicitly, and neither `userEvent` nor `fireEvent` do. This surfaced as a nonzero
   `vitest` exit code (would have failed `pre-push`) despite every assertion passing. Two
   attempts at a global fix — subclassing `MouseEvent`, patching
   `MouseEvent.prototype.view` via `Object.defineProperty` — were each tried and both broke
   jsdom's own environment bootstrapping *worse*, reproducing "document is not defined" on
   completely unrelated renders; confirmed by isolating each change and reverting. Fixed at
   the call site instead: `fireEvent.click()` (fires exactly one `'click'` event — all RF's
   `onNodeClick`/`onPaneClick`/`onEdgeClick` actually listen for) instead of
   `userEvent.click()` (fires a realistic full pointerdown/mousedown/mouseup/click sequence,
   including the `mousedown` that triggers this).
6. **`BlockCanvas`'s initial fixed `defaultViewport` (`x:0,y:0,zoom:0.8`) rendered two cards
   cut off above the viewport's top edge** on the real sample fixture — caught by the headless
   screenshot verification above, not by any test (no test asserted on actual pixel framing).
   dagre's raw layout coordinates depend on graph shape and aren't centered around the origin,
   so a fixed viewport only happens to work for whichever graph shape you tested with. Fixed
   with RF's `fitView` (computed from actual node bounds) instead; `onReset` now calls
   `fitView()` again rather than resetting to a fixed viewport.
7. **Vite's default root-absolute asset paths (`/assets/...`) don't resolve under a
   `vscode-webview://` URI**, which isn't served from `/` — confirmed directly against the
   built output before assuming it was a problem. Fixed with `base: './'` in
   `webview/vite.config.ts`, so every asset reference the build emits (including the CSS's
   own `@font-face url()`s) is relative and resolves once `webview-html.ts` injects a
   `<base>` tag — no per-asset URL rewriting needed in `panel.ts`.

Also found and fixed, smaller: `extension/` had no `vitest.config.ts` of its own — `.vscodeignore`
had actually already referenced one (a forward reference from an earlier task, harmless until
now), but without it vitest's default `**/*.test.ts[x]` discovery swept up the newly-added
nested `webview/` workspace's own test suite too, failing all of them under `extension`'s
`node` environment instead of `webview`'s own `jsdom` one. Scoped `extension`'s test include
to `test/**/*.test.ts`. And an `exactOptionalPropertyTypes` strictness error on
`RiskEdge.tsx`'s `markerEnd` prop (`string | undefined` from `EdgeProps`, not assignable to
`markerEnd?: string`), fixed with a conditional spread rather than loosening the compiler flag.

**Two-pass adversarial review (2026-07-21): run, findings reconciled, fixes applied.**

Doc-consistency pass verified every numeric claim above by actually re-running the gates
(not trusting the prose) and found them accurate, confirmed `TASKS-V1.md`/`ROADMAP-V2.md`
untouched, and found every cross-doc claim between `DIRECTORY-TREE.md`/`LAYERS.md`/
`PROTOCOL.md` consistent with the real code — plus one real gap: five new CSS files
(`flow/{BlockCanvas,BlockCard,RiskEdge}.css`, `ui/{StatusBar,ZoomControls}.css`) were entirely
missing from `DIRECTORY-TREE.md` despite the doc's own "every file, annotated" charter and
despite every sibling `.tsx` in the same directories being listed in full — added. Also noted,
smaller: `extension/webview/test/` was described in prose rather than enumerated file-by-file
the way `core/test/` is (a real but accepted inconsistency in rigor, not fixed — the prose
description is still accurate); and that `extension/webview/**` already type-imports from
`@blocknet/core` (fixtures, `graph-derive.ts`, `layout.ts`) even though no doc says so
explicitly, which doesn't contradict anything (it's the data-type surface, not
`shared/protocol.ts`'s message contract) but is worth knowing before assuming zero coupling.

Architectural-soundness pass found **two real bugs**, both fixed with regression tests:

1. **Node drag silently did nothing** — `BlockCanvas.tsx`'s `<ReactFlow>` ran in controlled
   mode (`nodes`/`edges` recomputed from props via `useMemo`, no `defaultNodes`) with no
   `onNodesChange` handler. Traced directly in `@xyflow/react`'s own source:
   `triggerNodeChanges` only commits a change back into the canonical node array when
   `hasDefaultNodes` is true, a flag set only by supplying `defaultNodes` — with neither that
   nor `onNodesChange`, every drag (and keyboard arrow-move) computed a new position and then
   silently discarded it on the very next render. Confirmed empirically (a real drag gesture
   left a node's `transform` completely unchanged) before being told it was fixed. This is a
   direct miss against Task 7's own stated acceptance criteria — `TASKS-V1.md` lists "node
   drag" as in-scope and "Pan/zoom/drag/select smooth at 30 blocks / 100 edges" as the literal
   acceptance line, not something deferred to Task 8 (Task 8 is about *persisting* layout
   across reload, a different concern). **Fixed**: `onNodesChange` now commits `'position'`
   -type changes into a `dragOverrides` map layered over `layout.ts`'s dagre output. First
   attempt at the fix caused a real regression of its own — reacting to every change type
   (not just `'position'`) created an infinite render loop, since a same-value-but-new-object
   state update on a `'dimensions'` change (fired by RF's own node-measurement pipeline)
   re-triggers measurement, which fires another `'dimensions'` change, forever; caught by the
   test suite itself (`Maximum update depth exceeded`), not missed. Narrowed the filter to
   `type === 'position'` only, which fixed it. Regression test added
   (`BlockCanvas.test.tsx`: "persists a node position after a move") using RF's own
   keyboard-driven node movement (arrow keys on a selected node) rather than a real mouse
   drag gesture — constructing a `MouseEvent` with an explicit `view` throws `"member view is
   not of type Window"` in this exact jsdom/vitest combination even in the most minimal
   possible case (`window instanceof Window` is `false` here — confirmed directly as a real
   jsdom/vitest module-duplication issue, not something in our control, and not the same
   `event.view`-is-null gap `test/setup.ts` already documents for d3-drag). Also verified in a
   **real** browser (headless Chromium via Playwright, not jsdom): a real mouse drag on
   `gateway` moved it and its connected risk edges followed correctly — confirming the fix
   works end-to-end, not just against the keyboard-based unit test's narrower path.
2. **`panel.ts` could get permanently stuck showing a blank panel** — `createOrReveal()`'s
   reuse path (`ArchitecturePanel.#current !== undefined`) reassigned `webview.html` but never
   `webview.options`, which is where `enableScripts` lives. Concrete failure: open the panel
   with no workspace (`enableScripts: false`, set once at `createWebviewPanel(...)`), then
   open a folder and re-trigger the command — `createOrReveal('ready', ...)` finds the
   existing panel, swaps in the real built HTML, but `enableScripts` stays `false` forever,
   so the bundle's `<script>` never runs. Confirmed `vscode.Webview.options` is a mutable,
   non-`readonly` property (`@types/vscode`), so this was a real, fixable gap, not an API
   limitation — and confirmed via `git show` that the missing-options-update logic predates
   Task 7 (it isn't a new regression), but Task 7 is what makes the `'ready'` state's entire
   content depend on that `<script>` actually running, raising the blast radius from "static
   text doesn't show" (Task 6) to "blank panel" (Task 7). **Fixed**: extracted a
   `webviewOptions()` helper used both at construction and on every reveal, so `.options`
   never drifts from the state actually being rendered. `panel.ts` has no dedicated test,
   consistent with this codebase's established convention for vscode-API shells
   (`watcher.ts`, `extension.ts` — none of them have one either, "verified manually via
   F5"); typechecked instead.

The same pass also flagged one **defensible-but-fixed-anyway** finding: `webview-html.ts`'s
nonce injection used a non-global `.replace()`, patching only the first `<script>` tag.
Today's build emits exactly one, so this wasn't live, but it would silently CSP-block (fail
closed, not open — not a security hole, but a hard-to-diagnose regression) any future second
`<script>` tag from e.g. vite code-splitting a vendor chunk. Added the `/g` flag and a
regression test asserting both tags get nonced in a synthetic multi-script fixture.

Concurrency/lifecycle correctness the pass explicitly verified by *running* real code, not
just reading it: `layout.ts`/`graph-derive.ts` stress-tested directly via `npx tsx` against
real cycles, self-referential edges, disconnected components, edges referencing nonexistent
node ids (stale/partial data), and the 30-node/100-edge scale — all handled correctly and
defensively, including confirming (via `core/src/edges/block-aggregate.ts`) that the real
analysis pipeline never actually emits self-referencing block edges, so the webview's
self-loop handling is defensive-only, not independently exploitable. The CSP itself was
checked against the real built bundle (not the test's synthetic fixture) and found
sufficient — no external domains or images anywhere in source or in `@xyflow/react`'s own
bundled CSS. `test/setup.ts`'s mocked 236×120 node dimensions were checked and ruled out as
masking a real bug, since every test asserts on DOM structure/data attributes/inline opacity,
never pixel geometry. `webview-html.ts` was checked against `cache-bridge.ts`/
`change-buffer.ts`'s established "pure, vscode-free, directly unit-tested" pattern and found
to genuinely follow it, not silently diverge.

### Task 8 — Bridge: live data + persisted layout ✅ (2026-07-21)

**What got built**, per TASKS-V1.md's acceptance criteria (real repo renders live; save-edit
round-trip updates the graph; node positions survive reload; risk popover shows real
evidence):

- `extension/src/shared/protocol.ts` gained `webview/ready` (`WebviewMessage`) — see "The
  ready handshake" below for why it's load-bearing, not decorative.
- `extension/src/state.ts` (new): `getPositions()`/`setPositions()` over a sparse
  `Record<string, Position>`, backed by `context.workspaceState`. Takes a narrow
  `WorkspaceMemento` structural type — the two methods it actually calls — rather than
  importing `vscode.Memento`, the exact pattern `cache-bridge.ts` already established for
  `context.storageUri`. **Deviates from LAYERS.md's pre-Task-8 guess**: that table placed
  `state.ts` in Layer 4 ("VS Code host glue, imports vscode") before it was built; built
  vscode-free instead, once it turned out to need nothing vscode-specific, and moved to Layer
  3 in this pass. **Also corrects a real doc/reality mismatch found while building it**:
  `DIRECTORY-TREE.md` described `state.ts` as owning "node positions + last-good manifest
  ptr" — the last-known-good `GraphResult` snapshot already lives in `core/cache/store.ts`
  under `context.storageUri` (`STATE-OWNERSHIP.md`), a disk cache with nothing to do with
  `workspaceState`; that line conflated two unrelated persistence mechanisms before either was
  actually built. `state.ts` owns positions only now, in both doc and code.
- `panel.ts`: `createOrReveal()` takes an `onLayoutPersist` callback, wired once at
  construction (not re-wired on reveal — see its own comment for why that's safe, not an
  oversight) into a `webview.onDidReceiveMessage` listener that calls it on `layout/persist`.
  New `whenReady(): Promise<void>`, a second independent `onDidReceiveMessage` subscription
  that resolves once on the next `webview/ready`.
- `commands/show-architecture.ts`: awaits `panel.whenReady()` before posting `layout/restore`
  (from `state.ts`) and *then* triggering analysis — the binding ordering guarantee
  `PROTOCOL.md` already documented as Task 8's job.
- `extension/webview/src/host-bridge.ts` (new, Layer 5, zero `vscode` import):
  `acquireVsCodeApi()` wrapped and memoized (VS Code throws if it's called twice per session —
  memoizing lazily, not at module load, also keeps every other webview test from needing the
  global mocked just to import a module that transitively pulls this one in).
  `postToHost()`/`onHostMessage()`. Imports `HostMessage`/`WebviewMessage` from
  `../../src/shared/protocol.ts` directly — a relative cross-boundary import; confirmed to
  resolve correctly through `tsc --noEmit`, `vite build`, and vitest's own vite-based transform
  pipeline (not assumed from `PROTOCOL.md`'s prior claim that it would).
- `extension/webview/src/camera-store.ts` (new): `useCameraStore()` hook — seeds from
  `layout/restore`'s positions, updates optimistically on every drag/arrow-move, debounces
  ~300ms before posting the full current (still sparse) map back as `layout/persist`. Replaces
  `BlockCanvas.tsx`'s local `dragOverrides` `useState` with this hook; the existing, two-pass-
  reviewed `onNodesChange` → position-commit logic itself is untouched, just now backed by a
  hook that also persists.
- `flow/layout.ts`: re-exports `Position` from `shared/protocol.ts` instead of declaring a
  second, structurally-identical type. **Deliberately does not** scope dagre to
  "ids absent from a positions map" the way its own pre-Task-8 comment predicted — dagre has
  no notion of a pinned node to lay out around, so that was never actually implementable as
  stated. Persisted/dragged positions are layered on top of dagre's unconditional full output
  at the `BlockCanvas.tsx` level instead, extending the exact mechanism already proven for live
  drag overrides rather than teaching dagre a pinning concept it doesn't have.
- `ui/RiskPopover.tsx` + `.css` (new): oneLine/explain/fix + evidence file:line list for the
  selected risk edge. "Risk badge click" is satisfied by clicking anywhere on a risky edge
  (already wired, already accessible via the existing `onEdgeClick`/selection path), not a
  second nested-interactive element on top of it — a second clickable badge inside an
  already-interactive edge would be the identical nested-interactive-element anti-pattern
  `BlockCard`'s `interactive` prop exists to avoid, just on an edge instead of a card. Fixed-
  position overlay, not anchored to the edge's own screen coordinates (would need RF's
  viewport-transform math for a purely cosmetic gain over a corner panel) — matches "lightweight
  popover, not the full v2 inspector."
- `App.tsx` rewritten: `?sample=1`/`?stress=1` now both bypass straight to `BlockCanvas` with a
  static fixture and never call `host-bridge.ts` at all — load-bearing, not just preserved
  convenience, since `acquireVsCodeApi()` doesn't exist in a plain browser and `LiveApp` would
  throw on mount without this escape hatch, which is exactly the dev/QA visual-verification
  path (`vite preview` + Playwright) this task still needed. Otherwise `LiveApp`: posts
  `webview/ready` after subscribing, shows an inline "Analyzing…" (`analysis/progress`'s
  phase/done/total once received) until `graph/macro` arrives, then renders `BlockCanvas` with
  `layout/restore`'s positions as `initialPositions`.

**The ready handshake.** VS Code drops any `postMessage` sent before the webview's own
`window.addEventListener('message', ...)` has registered — no queue. Tracing `panel.ts`'s
existing `createOrReveal()` found it reassigns `webview.html` **unconditionally on every call,
including reveal of an already-'ready' panel showing identical content** — a pre-existing
behavior, not something this task introduced, but one that means every single command
invocation is a fresh navigation and a fresh listener-registration race, not just first
construction. Without a real signal, `layout/restore` (which must precede `graph/macro` per
`PROTOCOL.md`'s ordering guarantee) risked silently never arriving on a fast/cached analysis
run. Fixed with a `webview/ready` handshake (`App.tsx` posts it first; `panel.ts`'s
`whenReady()` gates every send on it) rather than trusting analysis's own wall-clock time to
outlast script load, which is exactly the kind of timing assumption that holds in every manual
test and then doesn't in production.

**Deliberately not fixed, found while tracing the above, out of Task 8's stated scope:**
`registerShowArchitectureCommand()` constructs a **new** `FileWatcher` on every command
invocation (not just first open) and pushes it to `context.subscriptions` — re-running "Show
Architecture" N times leaves N live watchers, each independently debouncing and forking a
redundant analysis worker on every subsequent save. Not a correctness bug (`AnalysisRunner`'s
shared generation counter still means only the latest result ever reaches the webview — see
`FLOWS.md` §2a), just wasted process forks in a rare (repeat-invocation) path. Pre-existing
since Task 6, unrelated to any of Task 8's three acceptance criteria, not touched here — flagged
for a future task rather than silently expanding this one's diff.

**`risks/update` is defined and sent but not consumed by the webview** — every risk the UI
shows (`StatusBar`'s count, `RiskPopover`) already comes from `graph/macro`'s own `Edge.risk`,
the identical `Risk` objects `risks/update` would otherwise duplicate. `App.tsx`'s message
switch has an explicit no-op case for it (not a silent drop), and `PROTOCOL.md` documents this
as deliberate — the natural home for a future dedicated risks-list view (`ROADMAP-V2.md`), not
dead protocol.

**`ui/EmptyState.tsx` was not built.** `panel.ts`'s no-workspace/multi-root bodies stay plain
inline HTML with `enableScripts: false` — no script runs for either state, so there's nothing
for a React component to buy there; converting them to a webview-rendered `EmptyState.tsx`
would mean enabling scripts for a state whose entire point is not needing any. Earlier docs
described this as deferred "to Task 8"; corrected to reflect it's simply not part of what this
task's real acceptance criteria asked for.

**Two-pass adversarial review (2026-07-21): run, findings triaged, all real findings fixed.**

Doc-consistency pass (independent agent, read-only) found 4 real issues, all fixed: (1)
`panel.ts`'s header comment still named a future `EmptyState.tsx` the project had already
decided against building, and described it as "driven by protocol messages" — the opposite of
the actual (and correct) `enableScripts: false` design; corrected. (2) `FLOWS.md`'s Flow 2
described a `graph-store` module that has never existed — the real receive path is `App.tsx`'s
`LiveApp`, which replaces its graph `useState` wholesale on every `graph/macro`, not a by-id
diff-merge; corrected. (3) `LAYERS.md`'s mermaid diagram omitted `change-buffer.ts` from
Layer 3 (present in the table) and grouped `watcher.ts` inside the vscode-free Layer 3 visually
despite the table correctly calling it out as the one Layer-3 file that imports `vscode`
("3b"); split into its own subgraph to match. (4) A pre-existing (Task 5) hedge-language
violation in `FLOWS.md` ("may or may not... an open question, not decided here" about
`changedFiles`) — `docs/architecture/` permanent docs may never carry undecided language per
`CLAUDE.md`; corrected to state the current fact (still unread) and note that wiring it isn't
tracked planned work, not a standing open question.

Architectural-soundness pass (a separate, independently-dispatched agent, read-only) found 6
findings, ranked; all fixed except one accepted-as-is with its reasoning corrected:

1. **CONFIRMED, high severity: a real re-entrancy race in the ready handshake.** Traced
   independently: `whenReady()` matched on message *type* alone, with no way to distinguish a
   `webview/ready` from a script instance a *later* `createOrReveal()` call had already
   superseded (every call reassigns `webview.html` unconditionally, even reveal-of-already-
   ready). A rapid double-invocation (e.g. a doubled keybinding) could resolve an *earlier*
   `whenReady()` call on a *stale* ready, posting `layout/restore`/`graph/macro` into a webview
   VS Code had already torn down — silently dropped, no queue, no error. **Fixed**:
   `webview/ready` now carries a `generation` id (`shared/protocol.ts`), minted fresh on every
   `webview.html` (re)assignment (`panel.ts`'s `#currentGeneration`, injected via a new
   `<meta name="blocknet-generation">` tag — `webview-html.ts`) and echoed back by `App.tsx`.
   `whenReady()` only resolves on a matching generation, and `show-architecture.ts` re-checks
   `isCurrentGeneration()` *after* it resolves (matching inside `whenReady()` alone isn't
   sufficient — see `panel.ts`'s own comment for why).
2. **CONFIRMED, disputed severity: `FileWatcher` accumulates unboundedly, not just "rare and
   harmless."** The original write-up called this a rare-path inefficiency; the review
   correctly pushed back — re-invoking "Show Architecture" is a normal action (the panel is a
   singleton; re-invoking while open is just a reveal), so N invocations left N live watchers
   forking N redundant analyses per save, permanently, for the session. Independently verified
   `AnalysisRunner`'s generation counter still guarantees correctness (only the true-latest
   result ever reaches the webview) — so not a correctness bug — but real, unbounded resource
   waste on a genuinely ordinary action, not a rare one. **Fixed**: watcher construction is now
   idempotent per root dir, reusing the same watcher across reveals.
3. **CONFIRMED (empirically, via a real `tsc` repro): no exhaustiveness check on `App.tsx`'s
   `HostMessage` switch** — a 5th `HostMessage` variant would compile clean and silently drop
   at runtime despite the "explicit no-op case, not a silent drop" reasoning claiming otherwise.
   **Fixed**: added a `default: { const exhaustive: never = message; }` guard.
4. **CONFIRMED, overstatement: `state.ts`'s comment claimed replace-not-merge "can't lose a
   concurrent write"** — false in general (two windows on the same workspace would each hold
   an independent camera-store snapshot; whichever persists last clobbers keys it never had).
   True *only* because v1 is single-workspace-root, single-window (VS Code focuses an existing
   window rather than opening a duplicate). **Fixed**: comment corrected to state the actual,
   narrower guarantee instead of a false general one; behavior unchanged (correct for v1).
5. **CONFIRMED, dev-only: React 18 StrictMode double-invokes `camera-store.ts`'s mount effect**,
   causing one wasted no-op `layout/persist` on mount in dev builds only (production strips
   StrictMode's double-invoke). Documented, not fixed — no data loss, dev-only.
6. **CONFIRMED, real: a pending debounced persist was silently dropped (not flushed) on
   unmount** — up to 300ms of the most recent drag could be lost if `camera-store`'s hook
   unmounted (a live `graph/macro` swap, or the panel closing) mid-debounce. **Fixed**: a
   separate mount-once effect now flushes any pending persist immediately in its cleanup,
   verified via two new regression tests (`camera-store.test.tsx`).

Both passes' claims that held up under scrutiny, stated plainly rather than assumed: the
generation-counter correctness argument for redundant analyses; the `webview/ready` handshake
being genuinely load-bearing (verified via `useState(initialPositions)` seeding — a late
`layout/restore` after `graph/macro` would be silently ignored); the ordering guarantee holding
even though the file watcher's `triggerAnalysis` path isn't itself gated on `whenReady()` (a
subtle, now explicitly-commented invariant: any watcher-triggered analysis either resolves
before the webview is ready, in which case its `graph/macro` is dropped, or after, in which
case a newer generation already exists and `isLatest()` discards it).

**Live interactive verification (2026-07-21) found more, and more severe, bugs than either
review pass — real-browser testing (Playwright against a running `vite dev` server, plus the
user driving the same dev server directly in their own browser) is not optional for this class
of change, confirmed empirically, not just asserted:**

1. **CONFIRMED, real: `camera-store.ts` threw an uncaught exception on every drag when no real
   VS Code host exists.** `App.tsx`'s `?sample=1`/`?stress=1` dev/QA fixture bypass renders the
   *same* `BlockCanvas` tree as the live path, including `camera-store`'s debounced persist —
   which unconditionally called `acquireVsCodeApi()` (nonexistent outside a real webview) ~300ms
   after every drag. Found via a real Playwright mouse-drag against the dev server, not by
   reading the code. **Fixed**: `host-bridge.ts`'s `getApi()` now falls back to a no-op when no
   real host is present, with a regression test. Also added a friendly `App.tsx` fallback
   message (instead of a silent crash-to-black-screen) for the base URL with no fixture param
   and no real host.
2. **CONFIRMED, severe, real: dragging desynced from the pointer and eventually broke
   entirely** — React Flow's own "trying to drag a node that is not initialized" warning
   (error #015) firing repeatedly under sustained real dragging, visually confirmed by the user
   ("everything goes black and disappears") and reproduced directly via a ~250-move Playwright
   drag. Root cause (confirmed by reading `@xyflow/react`'s own `applyNodeChanges` source, not
   assumed): the hand-rolled position-patch in `onNodesChange` rebuilt *every* node's object
   identity on *every* drag frame (not just the dragged one) and never set the `dragging` flag
   RF's controlled-mode contract expects — racing RF's own internal node-registration effect.
   The race was fast-timing-dependent: with browser DevTools open (which slows JS execution)
   it did not reproduce, which is exactly the signature of a race, not a deterministic bug, and
   is why neither review pass caught it (both were static/read-only, not exercising rendering
   under load). **Fixed** in two stages: first split `flowNodes` so unrelated nodes keep stable
   object identity across a drag (reduced severity, confirmed live — the smaller "tiny flicker"
   variant of the same bug was still present); then rewrote the drag path to use React Flow's
   own `applyNodeChanges` utility end to end (the officially documented controlled-mode
   pattern), which correctly threads through `dragging`/`measured` instead of hand-rolling
   position-only patching. Verified via a new `BlockCanvas.test.tsx` regression test (a live
   `nodes`/`edges` prop update preserves a dragged position) and a repeated real sustained-drag
   Playwright pass showing zero #015 warnings.
3. **CONFIRMED, real: `RiskPopover` was visually clipped/covered by `StatusBar`.**
   `StatusBar.css` is a fixed top strip (`top:0`, `height:54px`, `z-index:20`); `RiskPopover`
   started at `top:16px`, `z-index:15` (`10` originally) — its header and close button sat
   partially underneath the status bar. Found by the user actually opening the popover, not by
   either review pass (a purely visual/layout defect, invisible to static code review).
   **Fixed**: repositioned below the status bar (`top:70px`).
4. **CONFIRMED, real: risk edges were unreliably clickable.** SVG has no z-index — paint (and
   hit-test) order is DOM order, so a risk edge earlier in the array could be visually and
   interactively buried under a later non-risk edge crossing the same point, especially
   pronounced on the 100-edge stress fixture. Found via the user directly struggling to click a
   risk connection. **Fixed**: risk edges now render last (stable sort — only risk-vs-non-risk
   relative order changes) and get a wider `interactionWidth` (32px vs 20px). Verified via a
   Playwright pass clicking 8 different risk edges at their geometric midpoint (not the visual
   badge): 8/8 opened the popover, versus real, reproducible misses before the fix.

**Explicitly considered and declined, at the user's direction**: extending the click popover to
*all* edges (not just risk ones), showing full connection detail with code — this is
`ROADMAP-V2.md`'s already-tracked "Connection Inspector" (v2.1), deliberately out of v1 scope;
confirmed with the user rather than silently built or silently skipped. Also raised: dedicated
edge-routing (draggable bend points) for large/messy graphs — noted as a future idea, not
scoped or built this task; not yet added to `ROADMAP-V2.md`, worth doing before it's forgotten.

**Verification actually performed:** `sh .githooks/pre-push` green across all three
workspaces after every fix above — core 267/267 (unchanged, 27 files), extension 31/31
(5 files), webview 63/63 (10 files), build/typecheck/lint clean. Real interactive verification:
sustained real-mouse Playwright drags (both short and ~250-300-move/4s sustained) against a
live `vite dev` server showing zero React Flow warnings and correct pointer tracking; 8/8
targeted risk-edge clicks along the actual curve (not just the badge) opening the popover;
Escape/close-button/pane-click dismissal all verified working in a real Chromium instance (not
just jsdom's `fireEvent`, which cannot catch real-focus-dependent bugs — see the Escape-key fix
below); the user independently drove the same dev server live throughout and confirmed the
fixes. One more real, live-only bug found this way: `RiskPopover`'s Escape-to-close handler was
on an unfocused `<div>` — real keydown events bubble from whatever element currently has
focus, not into unfocused descendants, so it silently never fired in a real browser despite
`RiskPopover.test.tsx`'s jsdom `fireEvent.keyDown` (which dispatches directly on the target
regardless of focus) passing throughout. **Fixed**: the dialog now takes focus on mount
(`tabIndex={-1}` + a mount effect), the standard WAI-ARIA dialog pattern, not just a fix for
this one bug. **Not yet performed**: a real F5 extension-development-host manual run for
Tasks 6–8 together — this environment still has no VS Code CLI/GUI. Everything above was
verified via `vite dev`/Playwright/direct user testing in a real browser, which is a real but
partial substitute — F5 is still the only way to verify the actual `postMessage` wiring against
a real `vscode.Webview`, the real ready-handshake timing, and real `workspaceState` persistence
end to end.

### Task 9 — Native delegation: split-screen open, dirty markers ✅ (2026-07-21)

**What got built**, per TASKS-V1.md's acceptance criteria (evidence link opens the file at the
exact import line; dirty blocks show the amber marker):

- `extension/src/dirty-blocks.ts` (new): pure `dirtyBlockIds(blocks, dirtyFiles)` —
  path-prefix aggregation (`dirtyFile === block.path || dirtyFile.startsWith(block.path +
  '/')`), a directory-boundary check so `apps/web` doesn't falsely match a sibling
  `apps/web-utils/foo.ts`. Split into its own vscode-free file specifically so this,
  the actual bug-prone logic, stays unit-tested (`extension/test/dirty-blocks.test.ts`, 7
  tests) even though `git.ts` (below) can't be — vitest has no `vscode` mock, and every other
  file importing `vscode` directly in this repo (`watcher.ts`, `panel.ts`,
  `show-architecture.ts`) already has zero unit tests for the same reason.
- `extension/src/git.ts` (new): `getDirtyFiles(rootDir)` — resolves the built-in `vscode.git`
  extension via a narrow structural type (`@types/vscode` doesn't ship the git extension's
  own API surface), reads `workingTreeChanges` + `indexChanges` across every repository it
  knows about, converts each to a POSIX-relative path, degrades to `[]` on any failure (no
  extension, no repo, activation error) — `ENGINEERING-CONSTRAINTS.md`'s "no git" degrade
  state, never a crash or a spurious "analysis failed" toast.
- `extension/src/commands/open-file.ts` (new): `handleOpenFile(rootDir, fileId, line?)` —
  validates `fileId` stays within `rootDir` once resolved (a postMessage boundary crossing,
  CLAUDE.md's "validate at system boundaries"), converts `Evidence.line`'s 1-indexed
  convention to `vscode.Position`'s 0-indexed one, calls `showTextDocument(uri, {viewColumn:
  Beside, selection})`. Catches a since-deleted/renamed file's rejection into a toast rather
  than an unhandled promise rejection.
- `extension/src/shared/protocol.ts`: added `WebviewBlockNode = BlockNode & { dirty: boolean
  }`, used only for `graph/macro`'s `nodes` — core's own `BlockNode` (frozen at Checkpoint B)
  is deliberately untouched, since dirty state is an extension-host-only concern
  (`STATE-OWNERSHIP.md`) core's analysis engine has no business knowing about.
- `extension/src/commands/show-architecture.ts`: `triggerAnalysis` now awaits
  `getDirtyFiles(rootDir)` and maps `dirtyBlockIds(...)` onto every block before posting
  `graph/macro` — re-checks `runner.isLatest(generation)` a second time after that await
  (not just before it), closing a real gap: a newer analysis run could complete and become
  the latest during the await window, and without the second check its dirty-augmented nodes
  would still get posted into a panel a fresher run had already superseded. `createOrReveal`
  gained an `onOpenFile` callback (mirroring the existing `onLayoutPersist` pattern), wired to
  `handleOpenFile`; the two degrade states (`no-workspace`/`multi-root`) get a `noopOnOpenFile`
  since no script ever runs there to send it.
- `extension/src/panel.ts`: constructor/`createOrReveal` take `onOpenFile`; message dispatch
  gained an `open/file` case alongside the existing `layout/persist` one.
- `extension/webview/src/flow/BlockCard.tsx` + `.css`: `dirty` prop renders a `● edited`
  marker (amber, `--bn-dirty` token mapped to `--vscode-gitDecoration-modifiedResourceForeground`
  so it visually matches VS Code's own git-modified color) next to the block name, before the
  risk pill.
  `extension/webview/src/flow/block-label.ts`'s `blockAriaLabel` gained an optional `dirty`
  param so the accessible name also announces "uncommitted changes."
- `extension/webview/src/ui/RiskPopover.tsx` + `.css`: evidence `file:line` entries are now a
  real `<button>` (was a `<span>`) posting `open/file` with the evidence's `file`/`line` on
  click — keyboard-operable natively, not a synthetic click handler on a non-interactive
  element.
- `extension/webview/src/flow/BlockCanvas.tsx`, `App.tsx`, both fixtures
  (`sample-graph.ts`/`stress-graph.ts`): threaded `WebviewBlockNode`/`dirty` through instead of
  plain `BlockNode` from `@blocknet/core`.

**Scope correction, agreed with Krish mid-task:** TASKS-V1.md's original Task 9 also specified
a block-card ⤢ triggering the same `open/file` flow. Checked directly against the design-
handoff prototype (`BlockNet.dc.html`) before building it: the ⤢ affordance only ever exists
on `microNodes` (per-file cards, the v2.0 micro view), never on `macroNodes` (blocks) — and
`BlockNode.path` is always a directory (`core/src/blocks/detect.ts`), never a single file, so
there's no canonical file for a block-level ⤢ (or the `open/diff` it would trigger) to target
without a drill-down step v1 doesn't have. Dropped from v1, deferred to
`ROADMAP-V2.md`'s already-existing v2.0 micro view entry (block/file ⤢ + `● edited` at file
granularity was already planned there). `open/diff` stays defined in the protocol,
unimplemented on both sides, for the same reason — no v1 UI trigger.

**Known, accepted limitation, not swept under the rug:** the synthetic `'(root)'` catch-all
block (files matching no detected block, `core/src/edges/resolve-block.ts`'s `ROOT_BLOCK_ID`,
not exported from core's public barrel) never shows a dirty marker even if a loose top-level
file is dirty — `dirty-blocks.ts`'s path-prefix match has no way to reach it without
duplicating core's own block-resolution cascade in the extension layer, a real drift risk for
a cosmetic marker. Not attempted for v1.

**Two-pass adversarial review + live verification, scoped to the whole repo (not just this
diff), per Krish's explicit request — both lanes' findings independently re-verified by
reading/grepping the actual files before fixing, not trusted as reported (one review round
hit a session-limit error and had to be resumed; both eventually completed).**

- **Doc-consistency lane — found the exact bookkeeping gap this entry itself is fixing**: this
  file's status table still said "Tasks 8-9 not started" despite a full Task 8 entry existing;
  a stale "None of the three exist yet" line for `state.ts`/`git.ts`/`open-file.ts`;
  `TASKS-V1.md`'s Task 9 header still said "(in progress)" with two of three acceptance boxes
  unchecked, even though both were actually done (I'd written those checkboxes early, before
  building the features, and never returned to flip them — a real gap in my own process, not
  the reviewer's error); root `README.md`/`CONTRIBUTING.md` still described a pre-Checkpoint-A,
  pre-`extension/` repo. All four fixed directly in this round.
- **Architectural-soundness lane — two real bugs, both fixed:**
  1. `commands/show-architecture.ts`'s `triggerAnalysis` gated every `panel.post()`
     (`analysis/progress`, `graph/macro`, `risks/update`) solely on `runner.isLatest()` (the
     *analysis* generation), never on `panel.isCurrentGeneration()` (the *panel* generation) —
     even though the identical race class was already found and fixed at the command-kickoff
     call site (`panel.ts`'s own comments describe it in detail). Traced concretely: a rapid
     re-invocation of the command reassigns `webview.html` (a new panel generation) while a
     prior analysis is still in flight; if that analysis completes before the new script sends
     its own `webview/ready`, the stale run's `graph/macro` could still post into the live
     panel out of order with `layout/restore`, breaking `PROTOCOL.md`'s stated ordering
     guarantee for that session. Fixed: `triggerAnalysis` now captures `panel.currentGeneration`
     once at call time and re-checks `panel.isCurrentGeneration()` immediately before every
     `panel.post()` (progress, graph/macro, risks/update alike) — error toasts are deliberately
     NOT gated on it, since `showErrorMessage` is a global notification, not a postMessage that
     can be silently dropped by a torn-down webview script.
  2. `git.ts` and `commands/open-file.ts` each reimplemented `core/src/path-utils.ts`'s
     `isWithinRoot()` path-containment check inline instead of importing it from
     `@blocknet/core/path-utils` — the exact subpath `change-buffer.ts` already imports
     `isExcludedPath` from, proving the import path works. Harmless today (the duplicated logic
     was correct), but a real, verifiable violation of `path-utils.ts`'s own stated reason for
     existing ("a path-escape bug fixed once... can't silently reappear, unguarded, in a
     sibling module"). Fixed: both now import `isWithinRoot` directly.
  3. Checked and ruled out: the async `getDirtyFiles()` await race (the *analysis*-generation
     re-check after the await is correct, already in place before this review), the
     ready-handshake generation-nonce mechanism, layer-boundary violations (`core` has zero
     `vscode` imports, confirmed via the passing `no-vscode-import.test.ts` plus a matching
     ESLint rule), `dirty-blocks.ts`'s duplication of `resolve-block.ts`'s prefix-match logic
     (defensible — `resolveBlock` isn't exported from core's public barrel, so there's no legal
     import path, unlike `isWithinRoot`), and core's Tarjan SCC / boundary-check / cache
     algorithms (all read and traced correct against their own documented rationale).

Live-verified via Playwright against a real `vite dev` server on `?sample=1`: the dirty marker
renders on exactly the fixture block flagged `dirty: true` and no others (screenshot-confirmed),
and clicking an evidence entry does not throw in the dev/QA fixture bypass (`host-bridge.ts`'s
no-op `postToHost` fallback, since `acquireVsCodeApi` doesn't exist outside a real webview) —
`RiskPopover.test.tsx`'s own unit test additionally asserts the exact `{type: 'open/file',
fileId, line}` payload against a mocked `postMessage`, which the fixture-mode live check can't.
Full `sh .githooks/pre-push` re-run green after all fixes: core 267/267, extension 38/38,
webview 68/68. **Not yet performed:** a real F5 extension-development-host run (same standing
gap as Tasks 6–8 — no VS Code CLI/GUI in this building environment) to verify the actual
`vscode.git` extension integration and `showTextDocument` call against a real workspace; a
third review round on the two architectural fixes themselves (the two-pass-review skill's own
rule is to loop back after a nontrivial fix) — not run, because the architectural-soundness
lane hit this account's monthly spend cap partway through this round and a further round was
judged not worth risking against the same limit. The two fixes were independently re-verified
by reading the actual code before applying them, not applied on the reviewer's word alone.

## Deferred by design (not gaps)

- `git.ts`, `commands/open-file.ts`, `ui/EmptyState.tsx` (see Task 8's entry above for why the
  latter isn't actually needed, not just postponed) — Task 9. `open/file`/`open/diff` are
  defined in `shared/protocol.ts` but unimplemented on both sides; no UI element in the webview
  sends them yet.

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
