# BlockNet

Render a TS/JS repository's block-level architecture graph — accurately and fast — with
import cycles and one boundary violation flagged, inside a VS Code webview that sits beside
the editor.

> **Status: pre-Checkpoint A.** The engine (`core/`) is under construction and unproven on
> real repos. There is no extension yet — see [`docs/architecture/LAYERS.md`](docs/architecture/LAYERS.md)
> for why UI work doesn't start until the engine is validated.

## What this is

Linters (`eslint`/`tsc`) check *code*. Nothing checks the map. BlockNet aggregates existing
analyzers' output (starting with [dependency-cruiser](https://github.com/sverweij/dependency-cruiser))
into one navigable, spatial view of a repo's block-level structure, with import cycles and
boundary violations flagged directly on the graph.

Full architecture, decisions, and rationale: [`docs/`](docs/README.md).

## Repo layout

- `core/` — `@blocknet/core`, a pure TypeScript library + CLI. Zero VS Code dependencies.
- `extension/` — the VS Code extension host + webview. Does not exist yet (see Status above).
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
