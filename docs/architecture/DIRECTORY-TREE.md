# Architecture — Directory Tree

The complete repository, annotated. Every file has exactly one reason to exist and belongs
to exactly one layer (see [LAYERS.md](./LAYERS.md) for the full layer-to-file mapping,
including `state.ts` and `git.ts`, both Layer 4).

```
BlockNet/
├── package.json                      # npm workspaces root: ["core", "extension", "extension/webview"]
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
│   ├── launch.json                   # F5 = Extension Development Host; preLaunchTask →
│   │                                 #   the build-extension task below (Task 6)
│   ├── tasks.json                    # build-extension: npm run build in extension/ — an
│   │                                 #   explicit task, not VS Code's auto-detected npm-task
│   │                                 #   naming, so launch.json's preLaunchTask can't drift
│   │                                 #   from a label VS Code generates (Task 6)
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
│   ├── tsup.config.ts                # bundles four entrypoints: index, cli, ipc-worker,
│   │                                 #   path-utils — splitting:false (each self-contained,
│   │                                 #   no shared chunk files) so extension/'s build can
│   │                                 #   copy ipc-worker.js out of dist/ in isolation
│   ├── src/
│   │   ├── index.ts                  # public API barrel: analyze() + all types. The ONLY file
│   │   │                             #   an external consumer (or the future v2 webapp)
│   │   │                             #   imports — except path-utils.ts, which has its own
│   │   │                             #   dedicated export (see its own entry below)
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
│   │   │                             #   Zero imports of its own — why it gets its own
│   │   │                             #   package.json "exports" entry (./path-utils, Task 6)
│   │   │                             #   instead of being re-exported from index.ts: staying
│   │   │                             #   importable without pulling in analyze.ts's
│   │   │                             #   dependency-cruiser graph, which extension/src/
│   │   │                             #   watcher.ts (bundled into a CJS target) can't
│   │   │                             #   tolerate — see decisions/0011's 2026-07-20 amendment.
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
│   │   │   │                         #   Deliberately does NOT exclude "(root)" as CIRCULAR
│   │   │   │                         #   excludes it from BOUNDARY (SCC membership is a raw
│   │   │   │                         #   graph fact, not a claim about a designed public
│   │   │   │                         #   surface) — see decisions/0006's amendment.
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
│   │   │                             #   flattened, wildcard leaves like "./*" compiled to
│   │   │                             #   a RegExp and matched directly — not resolved via
│   │   │                             #   the filesystem) when present, else `main`, else the
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
│   │   ├── cache/                    # LAYER 1 — incrementality. Added with Task 5,
│   │   │   │                         #   2026-07-19 (decisions/0008).
│   │   │   ├── manifest.ts           # builds a CacheManifest from the current file list:
│   │   │   │                         #   per-file content hash, plus one configHash
│   │   │   │                         #   covering every package.json/
│   │   │   │                         #   tsconfig.json in the tree. A file outside
│   │   │   │                         #   TS/JS's resolvable extensions never has its
│   │   │   │                         #   content read at all (a constant placeholder hash
│   │   │   │                         #   is used instead) — it can never be a
│   │   │   │                         #   dependency-cruiser module, so its bytes can never
│   │   │   │                         #   affect a FileEdge; only its existence matters,
│   │   │   │                         #   already tracked via the manifest's key set. A real
│   │   │   │                         #   Aether repo's 504MB checked-in Docker archive
│   │   │   │                         #   proved this isn't a hypothetical: reading it (and
│   │   │   │                         #   two 69MB PDFs) turned a claimed instant cache hit
│   │   │   │                         #   into a 10-second read before this existed.
│   │   │   ├── invalidate.ts         # diffs a previous CacheManifest against the current
│   │   │   │                         #   one into an InvalidationPlan — cold / config-
│   │   │   │                         #   changed / structural-changed (file added or
│   │   │   │                         #   removed — always a full bust, see the module's
│   │   │   │                         #   header comment for why scoping add/delete would
│   │   │   │                         #   need an unresolved-import reverse-index this
│   │   │   │                         #   engine doesn't build) / unchanged / content-
│   │   │   │                         #   changed (the only scoped case — lists exactly the
│   │   │   │                         #   files whose hash changed).
│   │   │   └── store.ts              # persists the manifest, the last GraphResult
│   │   │                             #   snapshot, AND the pre-aggregation FileEdge[] the
│   │   │                             #   delta path merges into — together, in ONE JSON
│   │   │                             #   file (write-temp-then-rename), not three
│   │   │                             #   independently-atomic ones: a crash between two
│   │   │                             #   separate atomic writes could leave a newer
│   │   │                             #   manifest paired with a stale snapshot on disk,
│   │   │                             #   which invalidate.ts would then read as
│   │   │                             #   "unchanged" and serve stale results forever. One
│   │   │                             #   file makes that interleaving impossible — see
│   │   │                             #   STATE-OWNERSHIP.md.
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
│       ├── cache.manifest.test.ts    # per-file/configHash hashing, incl. the non-source-
│       │                             #   file content-skip. Added with Task 5.
│       ├── cache.store.test.ts       # round-trip, atomicity, corrupt/missing degrade.
│       │                             #   Added with Task 5.
│       ├── cache.invalidate.test.ts  # all five InvalidationPlan kinds + priority order.
│       │                             #   Added with Task 5.
│       ├── analyze.cache.test.ts     # end-to-end: cold/unchanged/content-changed/config-
│       │                             #   changed/structural-changed on a mutated temp repo,
│       │                             #   mirroring analyze.edges.test.ts's/
│       │                             #   analyze.risks.test.ts's pattern. Added with Task 5.
│       └── cli.test.ts
│
├── extension/                        # @blocknet/extension. package.json IS the VS Code
│   │                                 #   extension manifest.
│   ├── package.json                  # name, publisher, engines.vscode, activationEvents,
│   │                                 #   contributes.commands, main → dist/extension.js
│   ├── tsconfig.json
│   ├── vitest.config.ts              # scopes test discovery to test/**/*.test.ts — without
│   │                                 #   it, vitest's default **/*.test.ts[x] sweep also
│   │                                 #   picks up the nested webview/ workspace's own tests
│   │                                 #   (jsdom + React Flow polyfills), failing them under
│   │                                 #   this workspace's 'node' environment (Task 7)
│   ├── esbuild.config.ts             # bundles the HOST only (src/) — separate from webview's
│   │                                 #   own vite build, never touched here. Also copies
│   │                                 #   @blocknet/core's own dist/ipc-worker.js verbatim into
│   │                                 #   dist/ipc-worker.mjs rather than re-bundling it — see
│   │                                 #   PROCESS-BOUNDARY.md
│   ├── .vscodeignore                 # excludes src/**, webview/src/**, test/** — see REPO-STANDARDS.md
│   ├── media/icon.png                # 128×128 Marketplace icon
│   │
│   ├── src/                          # LAYERS 3-4 — everything with a vscode import, except
│   │   │                             #   analysis-runner.ts/cache-bridge.ts/change-buffer.ts/
│   │   │                             #   webview-html.ts, deliberately kept vscode-free — see
│   │   │                             #   LAYERS.md
│   │   ├── extension.ts              # activate()/deactivate(); lazy activation
│   │   │                             #   (workspaceContains:**/tsconfig.json explicit;
│   │   │                             #   onCommand auto-generated from contributes.commands
│   │   │                             #   — see ENGINEERING-CONSTRAINTS.md). Resolves
│   │   │                             #   dist/ipc-worker.mjs's path from its own __dirname
│   │   │                             #   and constructs AnalysisRunner with it.
│   │   ├── analysis-runner.ts        # owns the forked child process lifecycle; tracks a
│   │   │                             #   monotonic generation id per run, discards results
│   │   │                             #   from a superseded generation — see FLOWS.md §2a.
│   │   │                             #   Takes workerPath as a constructor param (Task 6) —
│   │   │                             #   see decisions/0011's 2026-07-20 amendment for why.
│   │   ├── cache-bridge.ts           # resolves context.storageUri → cache dir for ipc-worker
│   │   ├── change-buffer.ts          # pure debounce-buffer bookkeeping: classifies events
│   │   │                             #   (content / add-delete-rename / config) per
│   │   │                             #   decisions/0008's priority order — see FLOWS.md §2a.
│   │   │                             #   No vscode import; watcher.ts's FileWatcher is the
│   │   │                             #   thin vscode-API shell wired on top of this.
│   │   ├── watcher.ts                # createFileSystemWatcher, debounces (~500ms), feeds
│   │   │                             #   change-buffer.ts, fires onTrigger with the flush
│   │   ├── webview-html.ts           # pure transform of the built webview/dist/index.html:
│   │   │                             #   injects a <base> tag (vite's base:'./' emits
│   │   │                             #   relative asset paths — see webview/vite.config.ts),
│   │   │                             #   a strict CSP meta tag, and a nonce on the built
│   │   │                             #   <script> tag. Takes webview.cspSource/asWebviewUri()
│   │   │                             #   results as plain strings, not the vscode.Webview
│   │   │                             #   object, so it's unit-testable headlessly (Task 7)
│   │   ├── panel.ts                  # WebviewPanel lifecycle: CSP, html shell, disposal. One
│   │   │                             #   panel, singleton. Serves the real built React Flow
│   │   │                             #   app (webview-html.ts + webview/dist/) since Task 7 —
│   │   │                             #   falls back to a friendly in-panel message (never a
│   │   │                             #   blank panel) if the webview bundle wasn't built. The
│   │   │                             #   no-workspace/multi-root bodies are still an inline
│   │   │                             #   stand-in for the real EmptyState.tsx (Task 8)
│   │   ├── state.ts                  # workspaceState: node positions + last-good manifest ptr
│   │   │                             #   — Task 8, not yet built
│   │   ├── git.ts                    # dirty-file lookup via the built-in git extension's API
│   │   │                             #   — Task 9, not yet built
│   │   │
│   │   ├── commands/
│   │   │   ├── show-architecture.ts  # `blocknet.showArchitecture` — creates/reveals the panel
│   │   │   └── open-file.ts          # showTextDocument + vscode.diff — see decisions/0009
│   │   │                             #   — Task 9, not yet built
│   │   │
│   │   └── shared/
│   │       └── protocol.ts           # see PROTOCOL.md. extension/src/** imports it
│   │                                 #   (panel.ts's post()); extension/webview/src/** doesn't
│   │                                 #   yet — Task 7 built the webview against static fixture
│   │                                 #   data, deliberately not this contract; Task 8 wires it
│   │
│   └── webview/                      # LAYER 5 — @blocknet/webview, its own npm workspace and
│       │                             #   npm package (not part of @blocknet/extension's own
│       │                             #   package — unlike LAYERS.md originally assumed),
│       │                             #   own vite build, zero vscode import. Built with Task 7
│       │                             #   against static fixture data only — see src/fixtures/
│       │                             #   and docs/planning/TASKS-V1.md
│       ├── package.json              # name: @blocknet/webview
│       ├── index.html
│       ├── vite.config.ts            # base:'./' (relative asset paths — a vscode-webview://
│       │                             #   URI isn't served from '/', confirmed directly; see
│       │                             #   its own header comment), output → dist/, packaged
│       │                             #   into the .vsix (.vscodeignore excludes webview/src/**
│       │                             #   but not webview/dist/**)
│       ├── tsconfig.json             # references tsconfig.app.json + tsconfig.node.json
│       ├── tsconfig.app.json         # extends ../../tsconfig.base.json (REPO-STANDARDS.md:
│       │                             #   "the only shared compiler config") + vite/browser-
│       │                             #   specific overrides (jsx, DOM lib, bundler resolution)
│       ├── tsconfig.node.json        # same pattern, for vite.config.ts itself (Node context)
│       ├── src/
│       │   ├── main.tsx              # createRoot(...).render(<App />)
│       │   ├── App.tsx               # renders <BlockCanvas> with static fixture data
│       │   │                         #   (sample-graph.ts, or stress-graph.ts behind a
│       │   │                         #   `?stress=1` dev/QA query param) — no postMessage,
│       │   │                         #   no EmptyState/ProgressBar routing yet (Task 8)
│       │   ├── index.css             # self-hosted @font-face (Space Grotesk + JetBrains
│       │   │                         #   Mono, variable-font woff2s in src/assets/fonts/),
│       │   │                         #   reset, scrollbar styling
│       │   │
│       │   ├── theme/
│       │   │   └── tokens.css        # design tokens as semantic custom properties resolving
│       │   │                         #   through var(--vscode-*, prototype-dark-fallback) —
│       │   │                         #   genuinely follows the host's light/dark/high-contrast
│       │   │                         #   theme (body.vscode-light/-dark/-high-contrast, set by
│       │   │                         #   VS Code itself) rather than forcing one fixed look
│       │   │
│       │   ├── flow/
│       │   │   ├── BlockCanvas.tsx   # React Flow root: fitView (not a fixed default
│       │   │   │                     #   viewport — dagre's raw coordinates aren't centered
│       │   │   │                     #   around origin), pan/zoom clamp k∈[0.3,2.4],
│       │   │   │                     #   selection-driven dimming, status bar + zoom controls.
│       │   │   │                     #   onNodesChange commits position-only changes into a
│       │   │   │                     #   dragOverrides map layered over layout.ts's dagre
│       │   │   │                     #   output — RF runs in controlled mode (no defaultNodes),
│       │   │   │                     #   so drag/arrow-key moves are silently discarded
│       │   │   │                     #   without it (two-pass review found this as a real bug)
│       │   │   ├── BlockCanvas.css   # full-bleed canvas sizing; hides RF's default
│       │   │   │                     #   selection-rect/connection-line chrome (dead code
│       │   │   │                     #   paths — nodesConnectable={false}, selectionOnDrag={false})
│       │   │   ├── BlockCard.tsx     # pure presentational card (dot/risk pill/tech
│       │   │   │                     #   pills/connection-count badge) — no React Flow
│       │   │   │                     #   dependency, so it's unit-testable in isolation;
│       │   │   │                     #   `interactive` prop suppresses its own role/tabIndex/
│       │   │   │                     #   keyboard handling when RF's own node wrapper (which
│       │   │   │                     #   already owns those) is the one mounting it
│       │   │   ├── BlockCard.css     # design tokens as CSS custom properties (theme/tokens.css)
│       │   │   ├── BlockNode.tsx     # thin RF NodeProps adapter: invisible Handle anchors
│       │   │   │                     #   (RiskEdge draws the visible port dot) + BlockCard
│       │   │   ├── RiskEdge.tsx      # bezier port→port (edge-path.ts's exact port of the
│       │   │   │                     #   design reference's pathOf(), not RF's generic
│       │   │   │                     #   getBezierPath, for visual parity); dashed animated /
│       │   │   │                     #   solid pulsing red with a "!" midpoint badge
│       │   │   ├── RiskEdge.css      # bnflow/bnpulse @keyframes — dashed-flow/risk-pulse animations,
│       │   │   │                     #   ported from the design reference verbatim
│       │   │   ├── edge-path.ts      # pure bezier path math, unit-tested independent of RF
│       │   │   ├── layout.ts         # dagre LR auto-layout — runs on every hydration for now
│       │   │   │                     #   (no persisted positions exist yet); Task 8 scopes
│       │   │   │                     #   this to BlockNode ids absent from a positions map
│       │   │   ├── graph-derive.ts   # pure: relatedIds() (selection→dimming, mirrors the
│       │   │   │                     #   design reference's relatedSet()) + connectionCounts()
│       │   │   │                     #   (the connection-count badge, new beyond the reference)
│       │   │   └── block-label.ts    # shared accessible-name text: BlockCard's own aria-label
│       │   │                         #   when standalone, and BlockCanvas.tsx's node.ariaLabel
│       │   │                         #   when RF's own node wrapper (which already provides
│       │   │                         #   tabIndex/role/keyboard handling) owns the a11y instead
│       │   │
│       │   ├── ui/
│       │   │   ├── StatusBar.tsx     # brand, legend, live risk count — no ProgressBar/
│       │   │   │                     #   EmptyState routing yet (Task 8)
│       │   │   ├── StatusBar.css
│       │   │   ├── ZoomControls.tsx  # −/percent/+/reset, mounted via RF's own <Panel>
│       │   │   └── ZoomControls.css
│       │   │
│       │   ├── fixtures/
│       │   │   ├── sample-graph.ts   # 5 blocks exercising every visual state at once: a real
│       │   │   │                     #   CIRCULAR cycle, a BOUNDARY deep-import, a risk-free edge
│       │   │   └── stress-graph.ts   # generated 30-block/100-edge fixture — Task 7's stated
│       │   │                         #   pan/zoom/drag/select scale target
│       │   │
│       │   └── assets/fonts/         # self-hosted Space Grotesk + JetBrains Mono, downloaded
│       │                             #   as their single variable-font woff2 each (Google
│       │                             #   Fonts serves one variable file across a declared
│       │                             #   weight range, not one static file per weight)
│       │
│       └── test/                     # jsdom + polyfills (ResizeObserver, DOMMatrixReadOnly)
│           │                         #   React Flow needs and jsdom doesn't provide — see
│           │                         #   setup.ts's own comments for what each one is for and
│           │                         #   why (confirmed by reading @xyflow/system's source,
│           │                         #   not assumed). BlockCanvas.test.tsx interactions use
│           │                         #   fireEvent.click, not userEvent.click — RF's pane/
│           │                         #   nodes carry native d3-drag/d3-zoom mousedown
│           │                         #   listeners that throw on jsdom's synthetic events
│           └── setup.ts
│
└── design_handoff_blocknet_extension/   # reference only — KEEP-surfaces per its README
```
