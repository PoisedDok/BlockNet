# Contributing

## Current state

BlockNet is pre-Checkpoint A (see [`docs/architecture/LAYERS.md`](docs/architecture/LAYERS.md)):
only `core/` exists. There is no VS Code extension to run yet, so there's no F5 dev-host
workflow — that lands in Task 6 (`docs/planning/TASKS-V1.md`), once `core` is validated on
real repos. This section will be filled in then.

**Before starting work, check [`docs/planning/PROGRESS.md`](docs/planning/PROGRESS.md)** —
it tracks what's actually done vs. `TASKS-V1.md`'s plan and names the next task, so you don't
have to re-derive state from git history.

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

## Before opening a PR

- `npm run build && npm test && npm run lint` all pass at the root.
- Read [`CLAUDE.md`](CLAUDE.md) and the docs it points to before touching architecture or
  decisions — don't silently drift from a locked ADR; propose a superseding one instead.
