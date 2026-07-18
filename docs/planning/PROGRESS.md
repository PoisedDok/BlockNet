# BlockNet v1 — Progress Tracker

Companion to [TASKS-V1.md](./TASKS-V1.md) — tracks what's *actually done* vs. that plan, so
work can resume cold without re-deriving context. Update this file as tasks complete. Do
not rewrite TASKS-V1.md/ROADMAP-V2.md themselves (`CLAUDE.md`).

## Status at a glance

| Phase | Status |
|---|---|
| Phase 1 — Engine (Tasks 1-5) | Tasks 1-2 done. Tasks 3-5 not started. |
| Checkpoint A (truth gate) | Not reached — no real edges/risks yet. |
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

## Next up

Task 3 (edges via dependency-cruiser) → 4 (risks) → 5 (cache) follow in order; each is
blocked on the previous. **Checkpoint A** (human review with Krish, real-repo truth check)
comes right after Task 3 — do not skip ahead to Task 4/5 without it.

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
  documents for incremental SCC scoping. Revisit as part of Checkpoint A right after Task 3.
