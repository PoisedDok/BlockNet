# BlockNet v1 — Progress Tracker

Companion to [TASKS-V1.md](./TASKS-V1.md) — tracks what's *actually done* vs. that plan, so
work can resume cold without re-deriving context. Update this file as tasks complete. Do
not rewrite TASKS-V1.md/ROADMAP-V2.md themselves (`CLAUDE.md`).

## Status at a glance

| Phase | Status |
|---|---|
| Phase 1 — Engine (Tasks 1-5) | Task 1 done. Tasks 2-5 not started. |
| Checkpoint A (truth gate) | Not reached — no real blocks/edges yet. |
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

## Next up

### Task 2 — Block auto-detection cascade (next, unstarted)
ADR: [decisions/0005](../decisions/0005-blocks-auto-detected.md). Build in `core/src/blocks/`:
- `workspaces.ts` (strategy 1: `package.json` workspaces / tsconfig refs)
- `conventional.ts` (strategy 2: `apps/ packages/ services/ libs/ infra/`)
- `flat-fallback.ts` (strategy 3: top-level folders under `src/`)
- `detect.ts` (cascade entrypoint, first non-empty wins; always appends synthetic `(root)`
  catch-all block)
- `pills.ts` (tech-pill derivation from each block's own `package.json`)

**Acceptance:** fixture monorepo → one block per workspace member; fixture flat repo →
blocks from top-level `src/` folders; tech pills reflect real deps. **Dependencies:** Task 1
(done). **Scope:** M. Needs `core/test/fixtures/{monorepo,flat-repo}` first.

Tasks 3 (edges via dependency-cruiser) → 4 (risks) → 5 (cache) follow in order; each is
blocked on the previous. **Checkpoint A** (human review with Krish, real-repo truth check)
comes right after Task 3 — do not skip ahead to Task 4/5 without it.

## Deferred by design (not gaps)

- `extension/`, `.vscode/launch.json` — Checkpoint B gate ([LAYERS.md](../architecture/LAYERS.md)).
- `core/src/log.ts` — arrives with Task 2, once there's a real phase to log
  ([DIRECTORY-TREE.md](../architecture/DIRECTORY-TREE.md)).
- `core/src/ipc-worker.ts` — arrives with Task 5.
- This directory is not yet a git repo (not requested; ready for one whenever asked).

## Tracked risks

- `typescript` pinned `^5.9.3` (not 6.x): tsup 8.5.1's DTS bundler breaks under TS 6.0's
  baseUrl-deprecation-as-error change. Dependabot has a matching `ignore` rule so a major
  bump doesn't land unreviewed — see CONTRIBUTING.md. Revisit when tsup fixes it upstream.
