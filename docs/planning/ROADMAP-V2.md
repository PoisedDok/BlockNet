# Roadmap: BlockNet v2+ — Everything Discussed, Deliberately Deferred

**Status:** Backlog — nothing here starts until v1 ships and Checkpoint A/C truths hold.
**Date:** 2026-07-10 · **Companion:** [TASKS-V1.md](./TASKS-V1.md)

This doc exists so v1 stays narrow without losing the thinking. Every item below was
discussed, shaped, and *deliberately cut* from v1. When v1 ships, promote items from here
in the listed order — each layer down requires a deeper (and slower) analysis, so each must
be earned by the layer above proving true.

---

## The full product vision (what "done" looks like)

A dev opens a repo, runs **BlockNet: Show Architecture**, and in seconds sees 8–15 blocks
with true connections; two red edges tell them the frontend hits the DB directly and two
packages are circular. They double-click a block and see its files and intra-block imports,
each with real LOC and an `● edited` marker. They click a red edge and see the exact import
statements side by side. Everything they've clicked has become AI context chips; they ask
"how do I fix this cycle?" and the model answers grounded in the actual files. ⤢ always
opens the **real** editor, split screen. BlockNet never edits code silently — *it flags and
explains structural risk and stages changes.*

v1 ships the macro layer of that. The rest lands in this order:

---

## v2.0 — Micro view: dive into a block (the very next thing)

**Status: shipped 2026-07-21** — see `docs/planning/PROGRESS-V2.md` for what was built, the
two-pass review findings, and live-verification results. v2.1 (Connection Inspector) is next
per this doc's own promotion order.

**What:** Double-click a block → cross-fade (~0.45–0.5s scale+opacity, per prototype) to
its file-level graph: file cards with real **LOC**, **`● edited`** git-dirty marker, ⚠ risk
pill, ⤢ split-screen open. Intra-block import edges. Breadcrumb `System Map / <block>`,
"← zoom out to map" button. Selection highlights the `relatedSet` (direct neighbors).

**Engine:** this is where **ts-morph** enters (per AD-3) — file-level detail and, later,
symbol-level. dep-cruiser file edges may suffice for the first cut; ts-morph when we need
per-import line ranges and symbols.

**Why deferred:** v1 must prove the macro layer is true and fast first; micro multiplies
node count 10–100× and needs its own perf work (possibly d3-force organic layout here —
the "Gource look" belongs at this layer if anywhere; sigma.js/graphology if file counts
demand WebGL).

## v2.0.1 — Directory-tree micro view: folders drill down too (Krish, 2026-07-21, before v2.1)

**Status:** planned, not started. Placed before v2.1 deliberately — it reshapes the model
v2.1's Connection Inspector gets built against, so building the inspector first would mean
rebuilding it immediately after this lands.

**The gap this closes:** v2.0 shipped a FLAT per-block file list — confirmed by reading the
current code: `core/src/analyze-micro.ts`'s `filesForBlock()` walks the WHOLE subtree under a
block and returns every file as one flat `MicroFileNode[]` regardless of nesting depth;
`MicroFileNode` (`core/src/types.ts`) carries a `path` field but nothing that groups files by
directory; `extension/webview/src/flow/file-layout.ts`'s `layoutFiles()` never reads that
`path` — every file becomes one sibling dagre node, positioned purely by import edges. There
is no locked decision behind this (checked every ADR in `docs/decisions/` — none address
directory nesting in the micro view); it's an implementation gap in what v2.0 built, not a
reversal of one.

**What:** Diving into a block (or a folder one level down) shows its DIRECT children only:
each subdirectory renders as its own drillable folder card (visually block-like, same
double-click-to-dive interaction as a macro block), each direct-child file renders as a file
leaf card exactly as today. Diving into a folder card recurses the identical view one level
deeper. Breadcrumb generalizes from the current fixed `System Map / <block>` to an arbitrary-
depth trail (`System Map / <block> / <folder> / <folder> / ...`), each segment clickable to
jump back to that exact level — not just one "← zoom out" step.

**Cross-layer connections (the other half of this item):** an import can cross from a file
several folders deep to a file that isn't a direct child of the currently-displayed layer
(an ancestor folder's own file, a cousin branch's file, etc.). Each layer must render that as
a visible "this connects to something outside this view" indicator — a faded/dashed stub
edge at the boundary of the layer, distinct from a normal in-layer edge — so a user can see
the connection exists and navigate (click the stub, or a breadcrumb segment) toward the real
endpoint, rather than the edge silently vanishing because its other end isn't on screen.
Exact visual treatment (edge stub vs. a small connection-count badge on the breadcrumb
segment vs. something else) is UNDECIDED — needs a short design pass, not full-specced here;
what's locked is the requirement itself (every cross-layer connection must be visible from
both layers it touches, never silently dropped).

**Engine implications (traced, not designed):** the repo-wide `FileEdge[]` `analyze()` already
produces has every edge regardless of which folder either endpoint lives in — resolving "is
this edge's other endpoint inside or outside the current layer" is a scoping/filtering
question against data that already exists, not new import-extraction work. What's missing is
a grouping concept above `MicroFileNode` (a folder-level node) and a query answering "for this
exact folder scope, which edges stay fully inside vs. cross the boundary."

**State implications (flagged, not designed):** `GraphView.tsx`'s view-state is currently a
fixed 3-phase machine, `'macro' | 'diving' | 'micro'` — one level of micro, hardcoded. This
generalizes to an arbitrary-depth stack of active path segments. `blocknet.filePositions` /
`blocknet.fileEdgeWaypoints` (`extension/src/state.ts`) are currently scoped per BLOCK — an
arbitrary-depth model needs these scoped per exact folder path instead, or two files in
different subfolders could collide on the same relative node id. Needs real design before
implementation; not decided here.

**Why this order:** v2.1's Connection Inspector (below) should open from ANY edge click,
including a cross-layer stub — sequencing this first means the inspector is built once,
against the real model, not once against a flat model and again after this lands.

## v2.1 — Connection Inspector (unique surface, keep from prototype)

**What:** Click an edge → docked panel: `source → target`, risk tag + one-liner, and **both
endpoint files side-by-side** with the import lines emphasized. "Open both" → two real
editor columns. "Ask Copilot ↗" forwards the connection to chat (once v2.2 lands). Extends to
v2.0.1's cross-layer stub edges too, once that lands — clicking a stub opens the same panel,
resolving the off-screen endpoint on demand rather than requiring the user to navigate there
first. Risk tag renders in the same red used everywhere else in this app for structural risk
(`#ef4444` per the existing edge/badge styling, `RiskEdge.css`) — one visual language for
"this connection is flagged," not a second one invented for this panel.

**Engine:** consumes `Risk.evidence` (file, line, statement) which v1's schema already
carries — designed forward on purpose. Host resolves edge → endpoint ranges on demand.

**Rule:** the side-by-side is a *read-only rendering* fetched from the host — still not an
editor. Diff tokens if we render our own read-only diff: add `#86c79a` on
`rgba(96,168,120,.12)`, del `#f0888a` on `rgba(239,68,68,.11)`.

## v2.2 — AI context chips + chat participant (the retention hook)

**What:** Every clicked node/edge/selection becomes an `@ label` chip (risky refs red, ✕ to
remove) — multi-reference, Cursor-style. Copilot dock bottom-right (368px per prototype).
Wire to `vscode.chat.createChatParticipant` + `vscode.lm`; chips define the context payload
(files + ranges) sent with the prompt; stream replies into the dock. Suggestion chips adapt
to whether context carries a flagged risk.

**Product stance (visible in copy):** *flags and explains structural risk and stages
changes; never silently rewrites code.* Staged changes = `WorkspaceEdit` preview with
accept/reject per hunk.

**Why deferred:** the graph must be loved first; AI bolted onto an untrusted graph is
noise. Also the honest self-check: we believe click-to-context is the daily-use retention
loop — **this is the hypothesis v2.2 tests.**

## v2.3 — Command palette + camera fly

**What:** ⌘K overlay fuzzy-filtering all blocks + files; selection **flies the camera**
(transient `transform .5s cubic-bezier(.4,0,.2,1)`, cleared ~560ms so drag stays snappy)
and adds the ref. Consider bridging to native quick-open where natural; the camera-fly to
the graph node is the point.

## v2.4 — Third risk check: DIRECT-DB / secret-reaches-client

**What:** Flag a module reachable from a client/browser entry that imports a DB driver
(`pg`, `mysql`…) or reads a secret env var at module scope. Fix hint: move behind an API
boundary.

**How (in order of increasing power):**
1. **Semgrep** rules first — light, cross-language, pattern-level ("no `process.env.X` in
   client components", "no DB driver import under `apps/web`").
2. **The bundler's own graph** (Vite/webpack stats) for client-bundle reachability — the
   bundler already computed the truth; read it rather than re-derive it.
3. **CodeQL** only if real dataflow/taint is needed — heavy; research-project territory.

**Why deferred:** reachability analysis is the noisiest check; false positives kill trust
(v1's core lesson). Ship it only with a validated low-FP recipe.

## v2.5 — Config overrides + more languages

- **`blocknet.json`:** user-declared blocks (globs → block) overriding the AD-5 auto-detect
  cascade — for repos where the heuristic guesses wrong.
- **Python** next (ruff `--output-format json` for rule signals; pydeps/import graph for
  edges) — covers the common TS-web + Python-backend split. The engine's aggregator design
  (reuse existing analyzers, merge their JSON) was chosen precisely to make this additive.
- **Multi-language via LSP** for on-demand drill-down only: `executeReferenceProvider`,
  `prepareCallHierarchy` (incoming/outgoing calls = real call graph),
  `executeWorkspaceSymbolProvider`. One code path, every installed language server.
  **Never for bulk indexing** — RPC-per-symbol makes whole-repo crawls take minutes. If
  bulk cross-language indexing is ever needed: **SCIP** indexers (scip-typescript,
  scip-python…) as the backbone, or tree-sitter(+stack-graphs) for syntax-level extraction.

## v2.6 — Function/symbol layer (macro → micro → nano)

**What:** Zoom below files: which function calls which, `findReferences` on click, symbol
nodes inside a file card. ts-morph (`LanguageService.getReferencesAtPosition`,
call-hierarchy) for TS; LSP call hierarchy elsewhere.

**Why last:** expensive, noisy at whole-repo scale, and only valuable once users already
live in the block/file layers. On-demand per-symbol, never bulk.

## v3 — Webapp marketing funnel

**What:** "Visualize any GitHub repo" web demo — paste a URL, get the block graph, share the
link. Pure acquisition funnel driving extension installs.

**Why possible cheaply:** `core/` has zero VS Code deps (AD-2) — the engine runs anywhere.
The webapp is a thin shell over the same `graph.json`.

**Why not the product:** no live workspace, can't sit beside the editor, commodity
pretty-picture territory (the Gource trap). Funnel, not tool.

## Also noted in the prototype, undecided

- Multi-file AI diff-review (accept/reject per hunk) — high value with the structural-edit
  angle; folds into v2.2's staged-changes stance.
- Blame-on-line; keyboard-only graph navigation (a11y).
- "Clouds" visual option: soft translucent group containers around related blocks — mock
  both before committing; blocks stay the primitive (legibility beat beauty in the v1 call).
- Monetization: free OSS now (AD-10); freemium (paid AI/team features) is the natural line
  *if* retention proves out — decide on data, not upfront.
- **Draggable/bendable edge routing** (Krish, 2026-07-21): ✅ shipped 2026-07-21, same day as
  scoped, then revised same session from a single fixed midpoint to full **multi-point**
  routing — grab the line anywhere to drop a new bend, drag any existing bend, drag one back
  near the straight line between its neighbors to remove it. Each handle is rendered through
  React Flow's `EdgeLabelRenderer`; the full waypoint array persists in
  `context.workspaceState` (`blocknet.edgeWaypoints`, macro; `blocknet.fileEdgeWaypoints`,
  micro) via the `state.ts` sparse-override pattern this note originally guessed at. See
  `docs/planning/PROGRESS-V2.md` for the full build record, including seven real bugs found
  via live Playwright testing and two further architectural-review passes. The
  coincident-midpoint limitation this note originally accepted is CLOSED, not just noted:
  `graph-derive.ts`'s `siblingOffsets()` now gives every edge between the same node pair
  (either direction) a distinct, stable rendering offset before any waypoint exists, so two
  reciprocal edges never render as literally overlapping curves.

---

## Hard-won context (do not re-litigate; re-read before promoting items)

- **Linters check code; nothing checks the map.** tsc/eslint/ruff are the *sensors* —
  single-file, rule-local, language-siloed. BlockNet is the aggregation layer that turns
  their signals into a spatial, cross-boundary, AI-addressable architecture. Build the
  aggregator, never the parsers.
- **The Gource lesson:** layout beauty (d3-force) and data truth (import edges) are
  independent layers. Beauty is commodity; truth is the product. Any time the pretty layer
  jumps the queue, stop.
- **The KEEP/DELEGATE rule** (from the design handoff, still binding): KEEP the graph
  canvas, zoom, ports, inspector, palette, context-chip model. DELEGATE editing, diff, git
  history, commit UX to native VS Code. A `<textarea>` editor in the webview = stop.
- **False positives are fatal.** Every risk check ships only when its FP rate on real repos
  is ~zero. Trust, once lost to a wrong red edge, doesn't come back.
- **The 70/30 trap:** scaffold + webview look like most of the work and are the easy 70%;
  the engine and trustworthy analysis are the valuable 30% that consumes the real effort.
  Progress on the pretty parts is not progress on the product.
- **Prior-art humility:** CodeSee built approximately this and shut down; IDE diagram views
  exist unused. "Nothing like this exists" is partly cope — the differentiators must be
  truthful risk detection, native delegation, and AI context, or this is another pretty
  graph. Validate retention with real users before scaling scope.
- **Performance is existential:** 5k–50k-file repos, child process, cache, incremental
  invalidation (content hash + add/delete/rename + config-bust). A frozen editor or a
  minute-late graph gets uninstalled.
