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
│   ├── workflows/ci.yml              # npm ci && build && typecheck && test (all --workspaces) && lint
│   └── dependabot.yml
├── .githooks/
│   └── pre-push                      # same five gates, run locally before push — see
│                                      #   REPO-STANDARDS.md's "CI — one pipeline, five gates"
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
│   │   ├── tsconfig-utils.ts         # shared JSONC-safe tsconfig.json reader; used by both
│   │   │                             #   blocks/workspaces.ts (project references) and
│   │   │                             #   edges/depcruise-runner.ts (path aliases) so the
│   │   │                             #   parse-error-degrades-to-warning behavior can't
│   │   │                             #   drift between the two call sites. Added with Task 3.
│   │   ├── path-utils.ts             # shared rootDir-containment predicate; used by both
│   │   │                             #   blocks/fs-utils.ts (workspace/tsconfig-reference
│   │   │                             #   candidates) and edges/{depcruise-runner,file-graph}.ts
│   │   │                             #   (resolved import targets) so a path-escape bug fixed
│   │   │                             #   once (Task 2) can't silently reappear unguarded in a
│   │   │                             #   sibling module. Added with Task 3. Also the single
│   │   │                             #   source of EXCLUDE_PATTERN_SOURCE (node_modules, build
│   │   │                             #   output incl. Rust's target/ and Python's __pycache__/
│   │   │                             #   venv/, every dot-directory) — both
│   │   │                             #   edges/depcruise-runner.ts (hands it to
│   │   │                             #   dependency-cruiser directly) and file-walk.ts (derives
│   │   │                             #   its own predicate from it) share this one definition.
│   │   ├── realpath-dedup.ts         # symlink-cycle safety for any recursive directory walk —
│   │   │                             #   caps cost at the number of distinct real directories
│   │   │                             #   regardless of alias/cycle count. Used by
│   │   │                             #   blocks/structural.ts and file-walk.ts. Added
│   │   │                             #   2026-07-19 after a branching symlink cycle measured
│   │   │                             #   over 12s without it (decisions/0005).
│   │   ├── file-walk.ts              # generic all-languages file inventory for fileCount —
│   │   │                             #   every real file, any language, same exclude rules as
│   │   │                             #   dependency-cruiser. Added 2026-07-19 (decisions/0005
│   │   │                             #   Amendment 2); import/edge analysis stays TS/JS-only
│   │   │                             #   (decisions/0004) — this is fileCount only.
│   │   │
│   │   ├── blocks/                   # LAYER 1 — block auto-detection
│   │   │   ├── detect.ts             # cascade entry point; first non-empty strategy wins.
│   │   │   │                         #   Does NOT append the synthetic "(root)" catch-all
│   │   │   │                         #   block itself — detect.ts never walks files, so it
│   │   │   │                         #   can't know one is needed. analyze.ts appends it
│   │   │   │                         #   conditionally once edges/resolve-block.ts (Task 3)
│   │   │   │                         #   finds a file matching no detected block's prefix.
│   │   │   ├── workspaces.ts         # strategy 1: package.json workspaces / tsconfig refs
│   │   │   ├── structural.ts         # strategy 2: generic host-walk — no folder-name
│   │   │   │                         #   vocabulary; a dir owning package.json is a block,
│   │   │   │                         #   non-hosts expand one level deeper, depth-capped.
│   │   │   │                         #   Deliberately JS/TS-only (hasPackageJson) — a 2nd
│   │   │   │                         #   2026-07-19 amendment reverted a same-day attempt to
│   │   │   │                         #   widen this to other languages here: one incidental
│   │   │   │                         #   deep non-JS manifest could hijack the whole cascade.
│   │   │   │                         #   See decisions/0005 Amendment 2.
│   │   │   ├── flat-fallback.ts      # strategy 3: top-level folders under src/
│   │   │   ├── other-languages.ts    # additive step 4, runs after the base cascade
│   │   │   │                         #   regardless of which strategy won: rootDir's own
│   │   │   │                         #   top-level children (ONLY that level, no recursion)
│   │   │   │                         #   checked for a non-JS manifest not already covered.
│   │   │   │                         #   Added 2026-07-19 (decisions/0005 Amendment 2) —
│   │   │   │                         #   deliberately shallow, can never preempt strategies 1-3.
│   │   │   ├── pills.ts              # tech-pill derivation from each block's own package.json.
│   │   │   │                         #   Falls back to the repo root's package.json ONLY when
│   │   │   │                         #   the block has no manifest of any kind (flat-fallback
│   │   │   │                         #   blocks) — a block with its own non-JS manifest
│   │   │   │                         #   (other-languages.ts) gets no pills, never the root's
│   │   │   │                         #   unrelated deps (fixed 2026-07-19, decisions/0005).
│   │   │   ├── fs-utils.ts           # shared symlink-following directory listing (used by
│   │   │   │                         #   all strategies; filters through path-utils.ts's
│   │   │   │                         #   isExcludedPath, not just dot-dirs/node_modules —
│   │   │   │                         #   fixed 2026-07-19 after a real vendored-package.json
│   │   │   │                         #   false positive, see decisions/0005), rootDir-
│   │   │   │                         #   containment guard, hasPackageJson (JS/TS host
│   │   │   │                         #   signal — workspaces.ts + structural.ts +
│   │   │   │                         #   risks/boundary.ts's "does this block even have a
│   │   │   │                         #   declared-entry concept" gate, added with Task 4),
│   │   │   │                         #   hasOtherLanguageManifest (non-JS host signal —
│   │   │   │                         #   other-languages.ts + pills.ts's fallback gate), and
│   │   │   │                         #   readPackageJson (shared read-and-degrade-on-corrupt
│   │   │   │                         #   parse used by pills.ts + risks/boundary.ts — added
│   │   │   │                         #   with Task 4 after starting to drift into a second copy)
│   │   │   └── internal-types.ts     # BlockCandidate — pre-pills shape strategies return
│   │   │
│   │   ├── edges/                    # LAYER 1 — import truth
│   │   │   ├── depcruise-runner.ts   # invokes dependency-cruiser's in-process API; binding
│   │   │   │                         #   exclude config from path-utils.ts's shared
│   │   │   │                         #   EXCLUDE_PATTERN_SOURCE (node_modules, build output
│   │   │   │                         #   incl. non-JS languages' target/__pycache__/venv/
│   │   │   │                         #   vendor, every dot-directory) — see decisions/0003.
│   │   │   │                         #   Also resolves tsconfig `paths` aliases itself
│   │   │   │                         #   (cwd-independent), rather than via dependency-cruiser's
│   │   │   │                         #   own tsConfig option.
│   │   │   ├── file-graph.ts         # normalizes dep-cruiser's module graph → FileEdge[]
│   │   │   ├── resolve-block.ts      # file path → owning block id (longest-prefix match);
│   │   │   │                         #   no match → the "(root)" catch-all block, never a
│   │   │   │                         #   silently dropped edge
│   │   │   └── block-aggregate.ts    # FileEdge[] → Edge[] at block granularity
│   │   │
│   │   ├── risks/                    # LAYER 1 — risk checks. Added with Task 4, 2026-07-19.
│   │   │   ├── index.ts              # runs all checks, merges into Risk[], attaches to
│   │   │   │                         #   Edge.risk. A directed block pair can carry BOTH
│   │   │   │                         #   tags at once — CIRCULAR wins the single-slot
│   │   │   │                         #   Edge.risk badge, but both Risk objects still land
│   │   │   │                         #   in the canonical risks[] list. CIRCULAR grouping
│   │   │   │                         #   only covers the CROSSING portion of a cyclic file
│   │   │   │                         #   edge set — a same-block leg of a cycle has no
│   │   │   │                         #   block-level Edge to attach to (block-aggregate.ts
│   │   │   │                         #   already drops intra-block edges), so it's real but
│   │   │   │                         #   out of v1's block-level scope, not fabricated.
│   │   │   ├── cycles.ts             # hand-rolled, ITERATIVE (not recursive) Tarjan SCC —
│   │   │   │                         #   a recursive DFS's stack depth tracks the longest
│   │   │   │                         #   import chain, not file count, and real repos build
│   │   │   │                         #   chains long enough to blow V8's default stack;
│   │   │   │                         #   proven safe with a 20,000-node chain regression
│   │   │   │                         #   test. Always run over the FULL edge list on every
│   │   │   │                         #   analysis — see decisions/0008 for why this isn't
│   │   │   │                         #   incrementally scoped
│   │   │   └── boundary.ts           # deep-import-vs-declared-entry rule; "declared entry"
│   │   │                             #   = the target block's full package.json `exports`
│   │   │                             #   map (all subpaths, nested condition objects
│   │   │                             #   flattened) when present, else `main`, else the
│   │   │                             #   block's own conventional index file (checked at
│   │   │                             #   BOTH `<block>/index.*` and `<block>/src/index.*`)
│   │   │                             #   — see decisions/0006's amendment for the exact
│   │   │                             #   algorithm. A target block with no package.json of
│   │   │                             #   its own (a flat-fallback block) is never checked —
│   │   │                             #   it has no declared-entry concept at all; omitting
│   │   │                             #   this gate was a real, caught-on-a-real-repo bug
│   │   │                             #   (100% of aetherinc's crossing edges flagged before
│   │   │                             #   the fix, see decisions/0006's amendment)
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
│       ├── log.test.ts
│       ├── fixtures/
│       │   ├── monorepo/             # npm-workspaces fixture: packages/a,b,c, each with a
│       │   │   └── ...               #   real dependency for pill tests (react/express/pg).
│       │   │                         #   Also carries, added with Task 3: a root tsconfig.json
│       │   │                         #   aliasing into c/src/internal.ts (a deep import,
│       │   │                         #   doubling as Task 4's boundary-violation fixture), a
│       │   │                         #   barrel import (b/src/index.ts re-exporting
│       │   │                         #   internal.ts), and a b↔c file-level import cycle.
│       │   └── flat-repo/            # single-package fixture: src/{auth,api,ui}. api/index.ts
│       │       └── ...               #   imports auth/index.ts, added with Task 3.
│       ├── path-utils.test.ts
│       ├── realpath-dedup.test.ts
│       ├── file-walk.test.ts
│       ├── blocks.workspaces.test.ts
│       ├── blocks.structural.test.ts
│       ├── blocks.other-languages.test.ts
│       ├── blocks.flat-fallback.test.ts
│       ├── blocks.pills.test.ts
│       ├── blocks.detect.test.ts
│       ├── edges.depcruise-runner.test.ts
│       ├── edges.file-graph.test.ts
│       ├── edges.resolve-block.test.ts
│       ├── edges.block-aggregate.test.ts
│       ├── analyze.edges.test.ts
│       ├── risks.cycles.test.ts
│       ├── risks.boundary.test.ts
│       ├── risks.index.test.ts       # merge logic: Edge.risk priority when a directed block
│       │                             #   pair carries both tags at once (CIRCULAR wins the
│       │                             #   single-slot badge; both Risk objects still survive
│       │                             #   into the canonical risks[] list). Added with Task 4.
│       ├── analyze.risks.test.ts     # end-to-end risks on the real monorepo fixture +
│       │                             #   riskCount tallying, mirroring analyze.edges.test.ts's
│       │                             #   pattern for Task 3. Added with Task 4.
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
