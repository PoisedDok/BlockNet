# Architecture — Directory Tree

The complete repository, annotated. Every file has exactly one reason to exist and belongs
to exactly one layer (see [LAYERS.md](./LAYERS.md) for the full layer-to-file mapping —
`state.ts` and `dirty-blocks.ts` are Layer 3 (vscode-free, unit-tested), `git.ts` and
`commands/open-file.ts` are Layer 4).

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
│   │   ├── analyze-micro.ts          # v2.0 (ROADMAP-V2.md): a single block's file-level
│   │   │                             #   graph, computed entirely from the LAST macro run's
│   │   │                             #   cache (cache/store.ts's persisted fileEdges) — never
│   │   │                             #   a fresh dependency-cruiser cruise. One whole-repo
│   │   │                             #   walkRealFiles(rootDir) filtered by resolveBlock() —
│   │   │                             #   matches analyze.ts's computeBlockShape() exactly (a
│   │   │                             #   per-block-scoped walk diverged on nested blocks and
│   │   │                             #   cross-block symlinks, both found via real-repo
│   │   │                             #   verification) — for real LOC (skipped, degrades to 0,
│   │   │                             #   for anything over 2MB), re-runs risks/cycles.ts's
│   │   │                             #   findCyclicFileEdges() UNFILTERED (unlike risks/
│   │   │                             #   index.ts, which only keeps the crossing portion for
│   │   │                             #   the macro graph — this is deliberately that same-block
│   │   │                             #   territory, see risks/index.ts's own header comment)
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
│       ├── ipc-worker.test.ts        # black-box, real forked worker + real IPC channel —
│       │                             #   same posture cli.test.ts takes toward cli.ts.
│       │                             #   Covers both `mode: 'macro'` (unchanged) and
│       │                             #   `mode: 'micro'` (v2.0)
│       ├── analyze-micro.test.ts     # checked-in monorepo fixture (cross-block BOUNDARY risk
│       │                             #   marks the real source file risky) + a dedicated
│       │                             #   intra-block-cycle temp-dir fixture (the "deliberate
│       │                             #   v1 scope boundary" risks/index.ts's header comment
│       │                             #   describes — this is what closes it) + the "(root)"
│       │                             #   catch-all block + nested-block, cross-block-symlink,
│       │                             #   and large-file (2MB LOC-scan cap) regression cases
│       │                             #   added after real-repo verification against aetherinc/
│       │                             #   AetherArenaV2/BlockNet-self found and fixed 3 real
│       │                             #   bugs (docs/planning/PROGRESS-V2.md). Added with v2.0
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
│   │   │                             #   webview-html.ts/state.ts/dirty-blocks.ts, deliberately
│   │   │                             #   kept vscode-free — see LAYERS.md
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
│   │   │                             #   v2.0: runMicro()/isLatestMicro() add a SECOND,
│   │   │                             #   independent generation counter/namespace for micro
│   │   │                             #   (file-level) requests — a save-triggered macro
│   │   │                             #   re-analysis must never supersede an in-flight,
│   │   │                             #   user-driven micro dive, and vice versa (PROTOCOL.md)
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
│   │   │                             #   no-workspace/multi-root bodies stay plain inline HTML
│   │   │                             #   (enableScripts: false) deliberately, not a React
│   │   │                             #   EmptyState.tsx — no script runs for either state, so
│   │   │                             #   there's nothing for a React component to buy here;
│   │   │                             #   still unimplemented, not deferred to a task. Also owns
│   │   │                             #   the ready handshake (whenReady()) and the layout/
│   │   │                             #   persist → onLayoutPersist callback wiring — see
│   │   │                             #   PROTOCOL.md. v2.0: also dispatches graph/micro/request
│   │   │                             #   → onMicroRequest, the third callback createOrReveal()
│   │   │                             #   takes alongside onLayoutPersist/onOpenFile
│   │   ├── state.ts                  # workspaceState: FOUR independent sparse maps — macro
│   │   │                             #   node positions (Task 8, `blocknet.positions`), macro
│   │   │                             #   edge waypoints (ROADMAP-V2.md's draggable/bendable
│   │   │                             #   edge routing, `blocknet.edgeWaypoints`), and their v2.0
│   │   │                             #   micro-view counterparts scoped per dived-into block
│   │   │                             #   (`blocknet.filePositions`, `blocknet.fileEdgeWaypoints`
│   │   │                             #   — GraphView.tsx's own second `useCameraStore` instance,
│   │   │                             #   posted via the `layout/file-persist` message). Each its
│   │   │                             #   own workspaceState key, mirrored get/set function pairs.
│   │   │                             #   Takes a narrow WorkspaceMemento structural type, not
│   │   │                             #   vscode.Memento — Layer 3, not 4 (see LAYERS.md). No
│   │   │                             #   manifest pointer — the last-known-good GraphResult
│   │   │                             #   snapshot already lives in core/cache/store.ts under
│   │   │                             #   context.storageUri (STATE-OWNERSHIP.md), a disk cache
│   │   │                             #   with nothing to do with workspaceState; this file's
│   │   │                             #   earlier description conflated the two before either was
│   │   │                             #   built
│   │   ├── dirty-blocks.ts           # (Task 9) pure `dirtyBlockIds(blocks, dirtyFiles)` path-
│   │   │                             #   prefix aggregation, zero vscode import — Layer 3, unit-
│   │   │                             #   tested (extension/test/dirty-blocks.test.ts). Split out
│   │   │                             #   from git.ts specifically so this bug-prone part stays
│   │   │                             #   testable even though git.ts itself can't be (vitest has
│   │   │                             #   no vscode mock)
│   │   ├── git.ts                    # (Task 9) dirty-file lookup via the built-in git
│   │   │                             #   extension's API (`getDirtyFiles`) — Layer 4, no unit
│   │   │                             #   tests (same posture as watcher.ts/panel.ts, verified
│   │   │                             #   manually), calls into dirty-blocks.ts's pure logic via
│   │   │                             #   show-architecture.ts, not internally
│   │   │
│   │   ├── commands/
│   │   │   ├── show-architecture.ts  # `blocknet.showArchitecture` — creates/reveals the panel;
│   │   │   │                         #   awaits panel.whenReady() before posting layout/restore
│   │   │   │                         #   (from state.ts) then triggering analysis — PROTOCOL.md.
│   │   │   │                         #   Also queries git.ts + dirty-blocks.ts on every
│   │   │   │                         #   graph/macro push to augment nodes with `dirty` (Task 9).
│   │   │   │                         #   v2.0: triggerMicroAnalysis() — same dual-generation-
│   │   │   │                         #   gate pattern as triggerAnalysis, posts graph/micro or
│   │   │   │                         #   graph/micro/error (FLOWS.md §5)
│   │   │   └── open-file.ts          # (Task 9) `open/file` → showTextDocument(uri,
│   │   │                             #   {viewColumn: Beside, selection}) — see decisions/0009.
│   │   │                             #   Unchanged by v2.0: FileCard's ⤢ (webview/src/flow/
│   │   │                             #   FileCard.tsx) is a second sender into the identical
│   │   │                             #   flow, needing no changes here (FLOWS.md §3). `open/
│   │   │                             #   diff` (vscode.diff) still stays unimplemented — no UI
│   │   │                             #   sends it, block or file level
│   │   │
│   │   └── shared/
│   │       └── protocol.ts           # see PROTOCOL.md. Both extension/src/** (panel.ts's
│   │                                 #   post()/onDidReceiveMessage, since Task 6) and
│   │                                 #   extension/webview/src/** (host-bridge.ts, since
│   │                                 #   Task 8) import it — a relative cross-boundary import,
│   │                                 #   no workspace-package indirection. v2.0: gains
│   │                                 #   WebviewMicroFileNode (MicroFileNode & {dirty}, the
│   │                                 #   same augmentation pattern as WebviewBlockNode) and the
│   │                                 #   graph/micro, graph/micro/error, graph/micro/request
│   │                                 #   message types
│   │
│   └── webview/                      # LAYER 5 — @blocknet/webview, its own npm workspace and
│       │                             #   npm package (not part of @blocknet/extension's own
│       │                             #   package — unlike LAYERS.md originally assumed),
│       │                             #   own vite build, zero vscode import (host-bridge.ts's
│       │                             #   acquireVsCodeApi() is a global, not a vscode import —
│       │                             #   see LAYERS.md). Live-data bridge wired in Task 8;
│       │                             #   src/fixtures/ still exist as a dev/QA-only bypass
│       │                             #   behind `?sample=1`/`?stress=1` — see App.tsx
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
│       │   ├── App.tsx               # `?sample=1`/`?stress=1` bypass straight to GraphView
│       │   │                         #   (v2.0: via FixtureApp, which resolves a block
│       │   │                         #   double-click against a static per-block dataset
│       │   │                         #   through a setTimeout, never a real host round-trip —
│       │   │                         #   host-bridge.ts's postToHost is a no-op outside a real
│       │   │                         #   webview, so nothing would ever answer a real
│       │   │                         #   graph/micro/request here) with a static macro
│       │   │                         #   fixture (dev/QA only — a real VS Code host never sets
│       │   │                         #   either param, and this is the only way to visually
│       │   │                         #   test outside one, since acquireVsCodeApi() doesn't
│       │   │                         #   exist in a plain browser). Otherwise LiveApp: posts
│       │   │                         #   webview/ready, subscribes via host-bridge.ts, shows an
│       │   │                         #   inline "Analyzing…" (+ analysis/progress phase/done/
│       │   │                         #   total once received) until graph/macro arrives, then
│       │   │                         #   renders GraphView with layout/restore's positions
│       │   │                         #   (v2.0: also forwards graph/micro/graph/micro/error
│       │   │                         #   into GraphView's micro/microError props). No dedicated
│       │   │                         #   ProgressBar/EmptyState component — the loading text is
│       │   │                         #   inline in LiveApp, and the no-workspace/multi-root
│       │   │                         #   states are still panel.ts's own plain HTML (see its
│       │   │                         #   entry above) — App.tsx is never even loaded for those
│       │   ├── host-bridge.ts        # acquireVsCodeApi() wrapper (memoized — VS Code throws if
│       │   │                         #   called twice), postToHost()/onHostMessage(). Imports
│       │   │                         #   WebviewMessage/HostMessage from
│       │   │                         #   ../../src/shared/protocol.ts directly (PROTOCOL.md)
│       │   ├── camera-store.ts       # useCameraStore() hook (FLOWS.md §4): seeds from
│       │   │                         #   layout/restore, updates optimistically on drag/arrow-
│       │   │                         #   move, debounces ~300ms before posting the full sparse
│       │   │                         #   positions map back as layout/persist. Also owns
│       │   │                         #   edgeWaypoints (ROADMAP-V2.md draggable/bendable edge
│       │   │                         #   routing) — ONE shared debounce/message for both maps,
│       │   │                         #   not two independent stores. Optional 3rd `persist`
│       │   │                         #   callback param (file-level drag parity): GraphView.tsx
│       │   │                         #   calls this hook a SECOND, independent time for file
│       │   │                         #   positions/waypoints, posting layout/file-persist instead
│       │   │                         #   of the default layout/persist — read via a ref, NOT a
│       │   │                         #   debounce-effect dependency, since GraphView passes a
│       │   │                         #   fresh inline-arrow identity every render (PROTOCOL.md)
│       │   ├── index.css             # self-hosted @font-face (Space Grotesk + JetBrains
│       │   │                         #   Mono, variable-font woff2s in src/assets/fonts/),
│       │   │                         #   reset, scrollbar styling, .bn-loading
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
│       │   │   │                     #   onNodesChange commits position-only changes into
│       │   │   │                     #   camera-store.ts's positions map, layered over
│       │   │   │                     #   layout.ts's dagre output — RF runs in controlled mode
│       │   │   │                     #   (no defaultNodes), so drag/arrow-key moves are
│       │   │   │                     #   silently discarded without it (two-pass review found
│       │   │   │                     #   this as a real bug). Also renders RiskPopover when the
│       │   │   │                     #   current edge selection carries a risk (Task 8). v2.0:
│       │   │   │                     #   onNodeDoubleClick → onBlockDoubleClick prop, gated on
│       │   │   │                     #   zoomOnDoubleClick={false} — a real, live-verified bug:
│       │   │   │                     #   React Flow's own zoomOnDoubleClick=true default has
│       │   │   │                     #   d3-zoom call stopImmediatePropagation() on the native
│       │   │   │                     #   dblclick event before it reaches React's synthetic
│       │   │   │                     #   onNodeDoubleClick, so a block double-click silently
│       │   │   │                     #   just zoomed instead of diving in until this was set —
│       │   │   │                     #   jsdom unit tests never caught it (fireEvent.doubleClick
│       │   │   │                     #   doesn't exercise d3-zoom's real listener), only real-
│       │   │   │                     #   browser Playwright verification did
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
│       │   │   │                     #   solid pulsing red with a "!" midpoint badge. Also
│       │   │   │                     #   WaypointHandle (ROADMAP-V2.md draggable/bendable edge
│       │   │   │                     #   routing): a draggable div rendered via React Flow's
│       │   │   │                     #   EdgeLabelRenderer (a shared overlay ABOVE all edges'
│       │   │   │                     #   SVG — an inline SVG circle was tried first and found,
│       │   │   │                     #   live, to lose hit-testing to unrelated edges' own wide
│       │   │   │                     #   interaction strokes), counter-scaled by 1/zoom so it
│       │   │   │                     #   stays grabbable at any zoom, with a drag-back-near-the-
│       │   │   │                     #   natural-midpoint reset gesture
│       │   │   ├── RiskEdge.css      # bnflow/bnpulse @keyframes — dashed-flow/risk-pulse animations,
│       │   │   │                     #   ported from the design reference verbatim. Also raises
│       │   │   │                     #   .react-flow__edgelabel-renderer's z-index above RF's own
│       │   │   │                     #   default, which otherwise paints every node card above
│       │   │   │                     #   the waypoint handle (PROTOCOL.md's "Draggable edge
│       │   │   │                     #   waypoints" section)
│       │   │   ├── edge-path.ts      # pure bezier path math, unit-tested independent of RF —
│       │   │   │                     #   optional waypoint param stitches two cubic segments
│       │   │   │                     #   through it instead of one (draggable edge routing)
│       │   │   ├── layout.ts         # dagre LR auto-layout — computes every node's position
│       │   │   │                     #   unconditionally (dagre has no "pinned node" concept
│       │   │   │                     #   to scope around); persisted/dragged positions are
│       │   │   │                     #   layered on top at BlockCanvas.tsx via camera-store.ts
│       │   │   │                     #   instead, same pattern proven for live drag overrides.
│       │   │   │                     #   Re-exports Position from shared/protocol.ts (Task 8)
│       │   │   │                     #   rather than declaring its own duplicate
│       │   │   ├── graph-derive.ts   # pure: relatedIds() (selection→dimming, mirrors the
│       │   │   │                     #   design reference's relatedSet(); typed generically over
│       │   │   │                     #   `{id,source,target}` since v2.0 — FileCanvas.tsx calls
│       │   │   │                     #   the identical function with MicroFileEdge[]) +
│       │   │   │                     #   connectionCounts() (the connection-count badge, new
│       │   │   │                     #   beyond the reference, macro-only — MicroFileNode has no
│       │   │   │                     #   connection-count badge in the design)
│       │   │   ├── block-label.ts    # shared accessible-name text: BlockCard's own aria-label
│       │   │   │                     #   when standalone, and BlockCanvas.tsx's node.ariaLabel
│       │   │   │                     #   when RF's own node wrapper (which already provides
│       │   │   │                     #   tabIndex/role/keyboard handling) owns the a11y instead
│       │   │   ├── GraphView.tsx     # v2.0 (ROADMAP-V2.md): owns the macro↔micro cross-fade —
│       │   │   │                     #   both BlockCanvas and FileCanvas are real, independent,
│       │   │   │                     #   permanently-mounted ReactFlow instances, cross-faded via
│       │   │   │                     #   CSS opacity+transform (mirrors the design-handoff
│       │   │   │                     #   prototype's own two-layer mechanism), never one canvas
│       │   │   │                     #   re-themed. Deliberately does NOT optimistically cross-
│       │   │   │                     #   fade the instant a double-click fires (unlike the
│       │   │   │                     #   prototype, which had no real async fetch) — macro stays
│       │   │   │                     #   interactive with a loading indicator until graph/micro
│       │   │   │                     #   (or graph/micro/error) actually arrives. Client-side
│       │   │   │                     #   third gating layer on top of the host's dual generation
│       │   │   │                     #   check (PROTOCOL.md): compares an incoming response's
│       │   │   │                     #   blockId against local pendingBlockId, discarding a late
│       │   │   │                     #   one for a block the user has since navigated away from.
│       │   │   │                     #   Also owns a SECOND useCameraStore instance (file-level
│       │   │   │                     #   drag parity, PROTOCOL.md) — the only component that
│       │   │   │                     #   survives FileCanvas's own per-dive remount for the
│       │   │   │                     #   panel's whole session, so it's the one that can preserve
│       │   │   │                     #   a dragged file position/waypoint across a same-session
│       │   │   │                     #   re-dive into a previously-visited block
│       │   │   ├── GraphView.css     # the cross-fade itself: opacity+transform transition,
│       │   │   │                     #   ~0.45–0.5s per the design-handoff prototype
│       │   │   ├── FileCanvas.tsx    # v2.0: file-level canvas for one block's dive-in — mirrors
│       │   │   │                     #   BlockCanvas.tsx's structure at file granularity (own
│       │   │   │                     #   pan/zoom/selection/dimming). No risk popover:
│       │   │   │                     #   MicroFileEdge only carries a boolean `risk`, not a full
│       │   │   │                     #   Risk with oneLine/explain/fix/evidence — the macro graph
│       │   │   │                     #   is where a crossing risk's full explanation already
│       │   │   │                     #   lives; this answers "which files/imports," not "why," a
│       │   │   │                     #   deliberately narrower first cut (DATA-MODEL.md). File
│       │   │   │                     #   cards and micro-edge waypoints now drag/persist like
│       │   │   │                     #   BlockCanvas's own (file-level drag parity, PROTOCOL.md);
│       │   │   │                     #   its initialPositions seed is captured once via useState's
│       │   │   │                     #   lazy initializer, deliberately NOT a live-reactive prop —
│       │   │   │                     #   see PROTOCOL.md for the real React Flow #015/flicker bug
│       │   │   │                     #   this fixes
│       │   │   ├── FileCanvas.css    # the "← zoom out to map" button (ROADMAP-V2.md's v2.0 spec
│       │   │   │                     #   names it explicitly, alongside the breadcrumb
│       │   │   │                     #   StatusBar.tsx already renders)
│       │   │   ├── FileNode.tsx      # thin RF NodeProps adapter, mirrors BlockNode.tsx exactly:
│       │   │   │                     #   invisible Handle anchors + FileCard
│       │   │   ├── FileCard.tsx      # pure presentational card, mirrors BlockCard.tsx's shape at
│       │   │   │                     #   file granularity (no pills, no connection-count badge).
│       │   │   │                     #   The ⤢ button posts open/file via onOpenInEditor
│       │   │   │                     #   (FileCanvas.tsx wires it to postToHost) — the same
│       │   │   │                     #   native-delegation flow RiskPopover's evidence links
│       │   │   │                     #   already use, never a webview-embedded editor
│       │   │   │                     #   (decisions/0009). Name + ⤢ sit on their own row, LOC/
│       │   │   │                     #   dirty/risk badges on a separate wrapping row below —
│       │   │   │                     #   NOT one crammed row: a real, live-verified bug (not
│       │   │   │                     #   theoretical) found the name shrink to 0px width (a
│       │   │   │                     #   flexbox min-width:auto pitfall under overflow:hidden)
│       │   │   │                     #   when sharing a row with the risk pill, then overlap
│       │   │   │                     #   once that was fixed but the row still wasn't wide
│       │   │   │                     #   enough — splitting the row, not a magic card width, is
│       │   │   │                     #   the actual fix (stays correct for real file names)
│       │   │   ├── FileCard.css      # min-width defensively also added to BlockCard.css's
│       │   │   │                     #   identical name-in-a-flex-row pattern — same latent
│       │   │   │                     #   failure mode, not yet reproduced there but the same fix
│       │   │   └── file-layout.ts    # dagre LR auto-layout for the micro graph, file-card-sized
│       │   │                         #   (not a shared generic with layout.ts — file cards render
│       │   │                         #   smaller, and there's exactly one caller on each side).
│       │   │                         #   Always the FRESH layout only — FileCanvas.tsx layers a
│       │   │                         #   persisted/dragged override on top (file-level drag
│       │   │                         #   parity, PROTOCOL.md), same pattern layout.ts's own
│       │   │                         #   comment describes for blocks
│       │   │
│       │   ├── ui/
│       │   │   ├── StatusBar.tsx     # brand, legend, live risk count (still derived from
│       │   │   │                     #   BlockCanvas's own edges prop, not risks/update — see
│       │   │   │                     #   PROTOCOL.md). No ProgressBar/EmptyState component —
│       │   │   │                     #   App.tsx's loading state is a plain inline div, not
│       │   │   │                     #   routed through here. v2.0: optional breadcrumb prop
│       │   │   │                     #   ("System Map / <block>", FileCanvas.tsx only — a block
│       │   │   │                     #   canvas has no parent block to name); risk count reflects
│       │   │   │                     #   risky FILES when passed one, risky EDGES otherwise —
│       │   │   │                     #   different views, deliberately different metrics
│       │   │   ├── StatusBar.css
│       │   │   ├── ZoomControls.tsx  # −/percent/+/reset, mounted via RF's own <Panel>
│       │   │   ├── ZoomControls.css
│       │   │   ├── RiskPopover.tsx   # lightweight popover (not the full v2 connection
│       │   │   │                     #   inspector): oneLine/explain/fix + evidence file:line
│       │   │   │                     #   list for the currently-selected risk edge. Fixed-
│       │   │   │                     #   position, not anchored to the edge's own screen
│       │   │   │                     #   coordinates (would need RF's viewport-transform math
│       │   │   │                     #   for a purely cosmetic gain). Closes on × click,
│       │   │   │                     #   Escape, or selecting something else (BlockCanvas.tsx)
│       │   │   └── RiskPopover.css
│       │   │
│       │   ├── fixtures/
│       │   │   ├── sample-graph.ts   # 5 blocks exercising every visual state at once: a real
│       │   │   │                     #   CIRCULAR cycle, a BOUNDARY deep-import, a risk-free
│       │   │   │                     #   edge. Dev/QA-only since Task 8 — see App.tsx. v2.0:
│       │   │   │                     #   sampleMicroByBlock — per-block file data covering a
│       │   │   │                     #   real intra-block cycle (services/gateway), a dirty +
│       │   │   │                     #   cross-block-risk file (apps/web), and a risk-free block
│       │   │   │                     #   with no intra-block edges (packages/ui) in one dataset
│       │   │   └── stress-graph.ts   # generated 30-block/100-edge fixture — Task 7's stated
│       │   │                         #   pan/zoom/drag/select scale target. Dev/QA-only since
│       │   │                         #   Task 8 — see App.tsx. v2.0: stressMicroByBlock covers
│       │   │                         #   only block-0 — diving into any other block exercises the
│       │   │                         #   graph/micro/error fallback path deliberately (micro-at-
│       │   │                         #   stress-scale is its own future perf question, ROADMAP-
│       │   │                         #   V2.md's own note, not something this fixture answers)
│       │   │
│       │   └── assets/fonts/         # self-hosted Space Grotesk + JetBrains Mono, downloaded
│       │                             #   as their single variable-font woff2 each (Google
│       │                             #   Fonts serves one variable file across a declared
│       │                             #   weight range, not one static file per weight)
│       │
│       └── test/                     # jsdom + polyfills (ResizeObserver, DOMMatrixReadOnly,
│           │                         #   Element.prototype.setPointerCapture/
│           │                         #   releasePointerCapture for RiskEdge.tsx's draggable
│           │                         #   waypoint handle) React Flow needs and jsdom doesn't
│           │                         #   provide — see setup.ts's own comments for what each one
│           │                         #   is for and why (confirmed by reading @xyflow/system's
│           │                         #   source, not assumed). BlockCanvas.test.tsx interactions
│           │                         #   use fireEvent.click, not userEvent.click — RF's pane/
│           │                         #   nodes carry native d3-drag/d3-zoom mousedown
│           │                         #   listeners that throw on jsdom's synthetic events
│           └── setup.ts
│
└── design_handoff_blocknet_extension/   # reference only — KEEP-surfaces per its README
```
