# Architecture — Directory Tree

The complete repository, annotated. Every file has exactly one reason to exist and belongs
to exactly one layer (see [LAYERS.md](./LAYERS.md) for the full layer-to-file mapping,
including `state.ts` and `git.ts`, both Layer 4).

```
BlockNet/
├── package.json                      # npm workspaces root: ["core", "extension"]
├── package-lock.json                 # single lockfile, single package manager
├── tsconfig.base.json                # shared strict compiler options, extended by both packages
├── eslint.config.js                  # flat config; carries the "core has no vscode import" rule
├── .gitignore
├── .editorconfig
├── .nvmrc                            # pins Node LTS — CI and README both read this, not a hardcode
├── LICENSE                           # MIT — required for Marketplace/OpenVSX (decisions/0010)
├── README.md                         # badges, GIF, quick start
├── CHANGELOG.md                      # Keep-a-Changelog format, one entry per release
├── CONTRIBUTING.md                   # F5 dev host instructions, test workflow, PR expectations
├── .vscode/
│   ├── launch.json                   # F5 = Extension Development Host, pointed at a real repo
│   └── extensions.json
├── .github/
│   ├── workflows/ci.yml              # npm ci && build --workspaces && test --workspaces && lint
│   └── dependabot.yml
│
├── docs/                             # see docs/README.md for the taxonomy
│
├── core/                             # @blocknet/core — pure TS. Zero vscode imports.
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsup.config.ts                # bundles three entrypoints: index, cli, ipc-worker
│   ├── src/
│   │   ├── index.ts                  # public API barrel: analyze() + all types. The ONLY file
│   │   │                             #   an external consumer (or the future v2 webapp) imports.
│   │   ├── types.ts                  # see DATA-MODEL.md
│   │   ├── analyze.ts                # orchestrator: detect() → runEdges() → runRisks() →
│   │   │                             #   cache.write() → GraphResult
│   │   ├── log.ts                    # tiny leveled logger; no I/O side effects as a library.
│   │   │                             #   Added with Task 2, once blocks/ has real phases to
│   │   │                             #   report — cli.ts/analyze.ts have nothing to log before then.
│   │   │
│   │   ├── blocks/                   # LAYER 1 — block auto-detection
│   │   │   ├── detect.ts             # cascade entry point; first non-empty strategy wins.
│   │   │   │                         #   Always appends one synthetic "(root)" catch-all
│   │   │   │                         #   block, populated only if resolve-block.ts finds
│   │   │   │                         #   files matching no detected block's path prefix.
│   │   │   ├── workspaces.ts         # strategy 1: package.json workspaces / tsconfig refs
│   │   │   ├── conventional.ts       # strategy 2: apps/ packages/ services/ libs/ infra/
│   │   │   ├── flat-fallback.ts      # strategy 3: top-level folders under src/
│   │   │   └── pills.ts              # tech-pill derivation from each block's own package.json
│   │   │
│   │   ├── edges/                    # LAYER 1 — import truth
│   │   │   ├── depcruise-runner.ts   # invokes dependency-cruiser's in-process API; binding
│   │   │   │                         #   exclude config: node_modules, .git, dist, build,
│   │   │   │                         #   out, coverage — see decisions/0003
│   │   │   ├── file-graph.ts         # normalizes dep-cruiser's module graph → FileEdge[]
│   │   │   ├── resolve-block.ts      # file path → owning block id (longest-prefix match);
│   │   │   │                         #   no match → the "(root)" catch-all block, never a
│   │   │   │                         #   silently dropped edge
│   │   │   └── block-aggregate.ts    # FileEdge[] → Edge[] at block granularity
│   │   │
│   │   ├── risks/                    # LAYER 1 — risk checks
│   │   │   ├── index.ts              # runs all checks, merges into Risk[], attaches to Edge.risk
│   │   │   ├── cycles.ts             # hand-rolled Tarjan SCC, always run over the FULL edge
│   │   │   │                         #   list on every analysis — see decisions/0008 for why
│   │   │   │                         #   this isn't incrementally scoped
│   │   │   └── boundary.ts           # deep-import-vs-declared-entry rule; "declared entry"
│   │   │                             #   = the target block's full package.json `exports`
│   │   │                             #   map (all subpaths) when present, else `main`/
│   │   │                             #   `index.ts` — see decisions/0006
│   │   │
│   │   ├── cache/                    # LAYER 1 — incrementality
│   │   │   ├── manifest.ts           # CacheManifest read/write; per-file hash + blockId
│   │   │   ├── invalidate.ts         # given changed files, computes the dirty scope
│   │   │   └── store.ts              # persists BOTH the CacheManifest and the last
│   │   │                             #   GraphResult snapshot to an injected cache dir
│   │   │
│   │   ├── cli.ts                    # LAYER 2 — `blocknet analyze <path> [--json] [--cache-dir]`
│   │   │                             #   human/CI entrypoint: stdout progress + final JSON
│   │   └── ipc-worker.ts             # LAYER 2 — child_process.fork() entrypoint; see
│   │                                 #   PROCESS-BOUNDARY.md
│   │
│   └── test/
│       ├── no-vscode-import.test.ts  # greps core/src for `from 'vscode'`
│       ├── fixtures/
│       │   ├── monorepo/             # npm-workspaces fixture: packages/a,b,c — b↔c is a
│       │   │   └── ...               #   deliberate cycle; a deep-imports c/src/internal
│       │   └── flat-repo/            # single-package fixture: src/{auth,api,ui}
│       │       └── ...
│       ├── blocks.test.ts
│       ├── edges.test.ts
│       ├── risks.cycles.test.ts
│       ├── risks.boundary.test.ts
│       ├── cache.test.ts
│       └── cli.test.ts
│
├── extension/                        # @blocknet/extension. package.json IS the VS Code
│   │                                 #   extension manifest.
│   ├── package.json                  # name, publisher, engines.vscode, activationEvents,
│   │                                 #   contributes.commands, main → dist/extension.js
│   ├── tsconfig.json
│   ├── esbuild.config.ts             # bundles the HOST only (src/) — separate from webview
│   ├── .vscodeignore                 # excludes src/**, webview/src/**, test/** — see REPO-STANDARDS.md
│   ├── media/icon.png                # 128×128 Marketplace icon
│   │
│   ├── src/                          # LAYERS 3-4 — everything with a vscode import
│   │   ├── extension.ts              # activate()/deactivate(); lazy activation
│   │   │                             #   (onCommand + workspaceContains:tsconfig.json);
│   │   │                             #   if workspaceFolders.length > 1, shows the
│   │   │                             #   multi-root EmptyState instead of analyzing —
│   │   │                             #   see ENGINEERING-CONSTRAINTS.md
│   │   ├── analysis-runner.ts        # owns the forked child process lifecycle; tracks a
│   │   │                             #   monotonic generation id per run, discards results
│   │   │                             #   from a superseded generation — see FLOWS.md §2a
│   │   ├── cache-bridge.ts           # resolves context.storageUri → cache dir for ipc-worker
│   │   ├── watcher.ts                # createFileSystemWatcher; buffers + debounces
│   │   │                             #   (~500ms) before classifying and triggering
│   │   │                             #   (content / add-delete-rename / config) — see
│   │   │                             #   decisions/0008, FLOWS.md §2a
│   │   ├── panel.ts                  # WebviewPanel lifecycle: CSP, fonts, html shell,
│   │   │                             #   disposal. One panel, singleton.
│   │   ├── state.ts                  # workspaceState: node positions + last-good manifest ptr
│   │   ├── git.ts                    # dirty-file lookup via the built-in git extension's API
│   │   │
│   │   ├── commands/
│   │   │   ├── show-architecture.ts  # `blocknet.showArchitecture` — creates/reveals the panel
│   │   │   └── open-file.ts          # showTextDocument + vscode.diff — see decisions/0009
│   │   │
│   │   └── shared/
│   │       └── protocol.ts           # see PROTOCOL.md — imported by both src/ and webview/src/
│   │
│   └── webview/                      # LAYER 5 — React app, own build (vite), zero vscode import
│       ├── index.html
│       ├── vite.config.ts            # output → extension/webview/dist, packaged into .vsix
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx               # top-level: EmptyState | ProgressBar | BlockCanvas
│       │   ├── vscode-api.ts         # acquireVsCodeApi() wrapper, typed on shared/protocol.ts
│       │   │
│       │   ├── state/
│       │   │   ├── graph-store.ts    # host-pushed, read-only mirror: nodes/edges/risks
│       │   │   └── camera-store.ts   # webview-owned: viewport, selection, in-flight drag
│       │   │
│       │   ├── flow/
│       │   │   ├── BlockCanvas.tsx   # React Flow root; pan/zoom clamp k∈[0.3,2.4]
│       │   │   ├── BlockNode.tsx     # card: status dot, risk pill, tech pills, ⤢ affordance
│       │   │   ├── RiskEdge.tsx      # bezier port→port; dashed animated / solid pulsing red
│       │   │   └── layout.ts         # dagre layout, applied per-node not per-session: runs
│       │   │                         #   on every graph/macro hydration for any BlockNode id
│       │   │                         #   absent from the positions map, leaving nodes that
│       │   │                         #   already have a persisted position untouched — so a
│       │   │                         #   block added mid-session still gets placed, not
│       │   │                         #   left at a default/undefined coordinate
│       │   │
│       │   ├── ui/
│       │   │   ├── ProgressBar.tsx   # renders analysis/progress {phase, done, total}
│       │   │   ├── RiskPopover.tsx   # oneLine/explain/fix + evidence list
│       │   │   └── EmptyState.tsx    # no-workspace / no-git / non-TS / <2-block /
│       │   │                         #   multi-root-workspace states
│       │   │
│       │   └── theme/tokens.css      # design tokens mapped onto var(--vscode-*)
│       │
│       └── fonts/                    # self-hosted Space Grotesk + JetBrains Mono
│
└── design_handoff_blocknet_extension/   # reference only — KEEP-surfaces per its README
```
