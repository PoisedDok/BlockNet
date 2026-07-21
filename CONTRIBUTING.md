# Contributing

## Current state

BlockNet has passed Checkpoint A (real-repo truth gate) and Checkpoint B (engine complete,
`graph.json` schema frozen) — see [`docs/architecture/LAYERS.md`](docs/architecture/LAYERS.md).
Tasks 1–9 of the v1 plan are done: `core/` (the analysis engine) and `extension/` (the VS Code
host + React Flow webview) are both built and tested. v1's Task 10 (packaging/publishing) is
deliberately deferred — v2 is being built first, layer by layer, per
[`docs/planning/ROADMAP-V2.md`](docs/planning/ROADMAP-V2.md)'s own promotion order. v2.0 (the
micro/file-level view) has shipped.

**Before starting work, check [`docs/planning/PROGRESS-V2.md`](docs/planning/PROGRESS-V2.md)**
(v2's build log — what's shipped, what's next per `ROADMAP-V2.md`) **and
[`docs/planning/PROGRESS.md`](docs/planning/PROGRESS.md)** (v1's identical-purpose tracker,
closed out) — together they track what's actually done vs. plan and name the next task, so
you don't have to re-derive state from git history.

## Running the extension (F5 dev host)

Open this repo in VS Code, then press F5 (or Run → Start Debugging) — this launches an
Extension Development Host window with BlockNet loaded. Build the webview bundle first if
you haven't (`npm run build --workspace=extension/webview`), since `extension/src/panel.ts`
serves the built `extension/webview/dist/` output, not a dev server. Run `BlockNet: Show
Architecture` from the command palette in the dev host window, on a folder containing a
TS/JS project.

For iterating on the webview UI alone without a real VS Code host, `npm run dev
--workspace=extension/webview` starts a Vite dev server serving `?sample=1` (a small fixture
with one real risk cycle) or `?stress=1` (30 blocks/100 edges) — see `App.tsx`'s dev/QA
fixture bypass. This never touches `acquireVsCodeApi()`, so it also runs in a plain browser.

## Setup

```sh
nvm use          # matches .nvmrc
npm install
```

## Working on `core`

```sh
npm run build --workspace=core
npm test --workspace=core
```

`core/` may never import `vscode` — enforced by `core/test/no-vscode-import.test.ts` and an
ESLint rule (`eslint.config.js`). See [`docs/decisions/0002-portable-core-zero-vscode-deps.md`](docs/decisions/0002-portable-core-zero-vscode-deps.md).

### Why `typescript` is pinned below 6.0.0

`package.json` pins `typescript@^5.9.3`, not the current 6.x line. TypeScript 6.0 turned
`baseUrl` deprecation into a hard error, and tsup 8.5.1's DTS bundler (`rollup-plugin-dts`)
injects an internal tsconfig that sets `baseUrl`, so `npm run build --workspace=core` fails
outright on TS 6. `.github/dependabot.yml` has a matching `ignore` rule so a major-version
bump doesn't land unreviewed. Revisit once tsup/rollup-plugin-dts ships a fix.

### Why `typecheck` is a separate script from `build`

`npm run build` (tsup) only compiles what's actually reachable from `core`'s declared
entrypoints (`index.ts`, `cli.ts`). A source file that exists but isn't imported by anything
yet — or a type error on a branch tsup's bundler doesn't need to touch — can pass `build`
while still being broken. `npm run typecheck` (`tsc --noEmit`) type-checks every file
`tsconfig.json` includes, regardless of what's wired up yet. Both gates run in CI and in the
local pre-push hook; `build` passing is not proof the code type-checks.

## Git hooks

`npm install` runs `prepare`, which points git at the committed `.githooks/` directory
(`core.hooksPath`). `pre-push` then runs the same gate as CI — build, typecheck, test, lint —
before a push leaves your machine. Bypass only deliberately with `git push --no-verify`, and
only when you already know why; that flag defeats the point of the hook.

## Before opening a PR

- `npm run build && npm run typecheck && npm test && npm run lint` all pass at the root
  (the pre-push hook already enforces this, but re-run explicitly if you bypassed it).
- Read [`CLAUDE.md`](CLAUDE.md) and the docs it points to before touching architecture or
  decisions — don't silently drift from a locked ADR; propose a superseding one instead.
