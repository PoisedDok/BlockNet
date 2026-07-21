# BlockNet

Render a TS/JS repository's block-level architecture graph — accurately and fast — with
import cycles and one boundary violation flagged, inside a VS Code webview that sits beside
the editor.

> **Status: pre-release.** v1 (Tasks 1–9 of 10) is done — Checkpoint A (real-repo truth gate)
> and Checkpoint B (engine complete, schema frozen) have both passed, and the engine (`core/`)
> plus the VS Code extension (host + webview) are built and tested. v1's Task 10
> (packaging/publishing) is deliberately not next: v2 is being built first — see
> [`docs/planning/ROADMAP-V2.md`](docs/planning/ROADMAP-V2.md) for the full backlog and
> [`docs/planning/PROGRESS-V2.md`](docs/planning/PROGRESS-V2.md) for what's shipped so far
> (v2.0, the micro/file-level view). [`docs/planning/PROGRESS.md`](docs/planning/PROGRESS.md)
> has v1's own build record, and [`docs/architecture/LAYERS.md`](docs/architecture/LAYERS.md)
> explains why UI work didn't start until the engine was validated.

## What this is

Linters (`eslint`/`tsc`) check *code*. Nothing checks the map. BlockNet aggregates existing
analyzers' output (starting with [dependency-cruiser](https://github.com/sverweij/dependency-cruiser))
into one navigable, spatial view of a repo's block-level structure, with import cycles and
boundary violations flagged directly on the graph.

Full architecture, decisions, and rationale: [`docs/`](docs/README.md).

## Repo layout

- `core/` — `@blocknet/core`, a pure TypeScript library + CLI. Zero VS Code dependencies.
- `extension/` — the VS Code extension host (`src/`) + React Flow webview (`webview/`, its own
  npm workspace).
- `docs/` — architecture (ground truth), decisions (ADRs), principles, and planning.

## Development

Requires the Node version pinned in [`.nvmrc`](.nvmrc) (`nvm use`).

```sh
npm install
npm run build   # builds all workspaces
npm test        # tests all workspaces
npm run lint
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for more.

## License

MIT — see [`LICENSE`](LICENSE).
