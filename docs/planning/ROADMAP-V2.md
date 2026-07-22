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
statements side by side. Meanwhile, whatever AI agent they already have open — Claude Code,
Copilot, anything — can query the same ground truth directly (`blocknet trace`/`impact`/
`path`, v2.2), so "how do I fix this cycle?" gets answered grounded in the actual files
instead of a grep-guess. ⤢ always opens the **real** editor, split screen. BlockNet never
edits code silently — *it flags and explains structural risk and stages changes.*

v1 ships the macro layer of that. The rest lands in this order:

---

## v2.0 — Micro view: dive into a block (the very next thing)

**Status: shipped 2026-07-21** — see `docs/planning/PROGRESS-V2.md` for what was built, the
two-pass review findings, and live-verification results. Superseded by v2.0.1 below (the
per-block micro view described here no longer exists as a separate thing — every layer,
including layer 0, is the unified model now). v2.0.1 shipped next, per this doc's own
promotion order; v2.1 (Connection Inspector) is next after that.

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

## v2.0.1 — Directory-tree micro view: folders drill down too

**Status: shipped 2026-07-22** — see `docs/planning/PROGRESS-V2.md` for what was built, the
two-pass review findings, and live-verification results. Sequenced before v2.1 — it reshapes
the model v2.1's Connection Inspector gets built against, so building the inspector first would
have meant rebuilding it immediately after this landed.

**The gap this closes:** v2.0 ships a FLAT per-block file list — `core/src/analyze-micro.ts`'s
`filesForBlock()` walks the WHOLE subtree under a block and returns every file as one flat
`MicroFileNode[]` regardless of nesting depth;
`MicroFileNode` (`core/src/types.ts`) carries a `path` field but nothing that groups files by
directory; `extension/webview/src/flow/file-layout.ts`'s `layoutFiles()` never reads that
`path` — every file becomes one sibling dagre node, positioned purely by import edges. There
is no locked decision behind this (checked every ADR in `docs/decisions/` — none address
directory nesting in the micro view); it's an implementation gap in what v2.0 built, not a
reversal of one.

**What — unified layer model (decided):** every layer, from the repo root down through
arbitrary directory depth, is architecturally identical — a stack of layers, one per real
directory level, connected vertically in a literal (not decorative) sense: **intra-layer
connections** are imports between two items rendered in the SAME layer (unchanged from
today's in-layer edge behavior); **inter-layer connections** are imports crossing between
layers (new — see below). Layer 0 (today's "macro" view) is NOT a special case: its item set
is repo root's own direct children, exactly like any other layer, with ONE special case —
whichever of those children AD-5 already decided is a detected block renders as a folder-card
covering that block's WHOLE subtree in one card (still carrying `pills`/`fileCount`/
`riskCount`, unchanged from today), even if the block's own path is several directories deep
(e.g. `apps/web/frontend`). Every other direct child of repo root — a file not claimed by any
block, or a plain directory not claimed by any block (e.g. `docs/`, with no `package.json` and
never chosen by AD-5) — renders as an ordinary file-leaf-card or plain folder-card
respectively, following the IDENTICAL recursive rule as any deeper layer: no pills, and if it's
a folder, diving into it shows only ITS direct children next. This decomposes what today's
synthetic `(root)` block flattens into one bucket back into real directory structure at
render time. `resolveBlock()`'s internal `(root)` bucket is UNCHANGED as a DATA concept — it
still exists for edge/risk attribution (a file's cross-block risk still needs a block id to
attribute to) — only the RENDERING of those files changes, from one flat wrapper card to their
real recursive folder/file structure. Diving into any folder-card (an AD-5 block or a plain
subdirectory — no visual distinction once you're inside it) shows its DIRECT children only,
same rule one level deeper: subdirectories → folder-cards, direct files → file-leaf-cards,
recursively, no depth limit. The layer-stack floor-picker (below) replaces the current fixed
`System Map / <block>` breadcrumb with one slab per real directory level from repo root to
the current layer.

**ADR-0005 compatibility, checked:** the synthetic `(root)` block's DATA requirement is
unchanged and still locked — every file must resolve to something, never silently dropped
(`decisions/0005`'s Decision section: "the alternative [dropping it] contradicts
`docs/PRINCIPLES.md`'s truth requirement more than an ungainly extra node does"). What changes
is rendering only: those files no longer need an extra click through a wrapper card to become
visible; they render directly at layer 0, same as any other layer's direct-child files. If
AD-5 detects zero blocks at all (a small flat repo), layer 0 degrades to exactly "the repo
root as a folder" — direct subdirectories and files, no synthetic wrapper needed at all; the
simpler case, not a harder one.

**Inter-layer connections (decided):** an import can cross from a file several directory
levels deep to a file that isn't rendered in the currently-displayed layer (an ancestor's own
file, a cousin branch's file, a file inside a not-yet-drilled sibling folder-card, etc.). Each
such edge renders as a small clickable arrow at the edge of its source card — never a stub
reaching nowhere, never silently dropped. Direction is depth-relative, not tree-relative: if
the target file's path is deeper than the currently-displayed layer, the arrow points down; if
shallower (reached only by walking back up), it points up. A same-depth target in a different
branch (a cousin file) points up, since the common ancestor must be reached first — there is no
lateral arrow variant. Multiple edges from different visible items to the SAME off-screen
target file collapse into one arrow, labeled with the target's filename (elevator-call
semantics: many requests for one floor become one indicator); edges to DISTINCT off-screen
targets render as distinct, separately labeled arrows. Clicking an arrow navigates the layer
stack straight to the target's folder and selects the target file — no manual walk
up-then-down required.

**Engine implications, generalized (this is the actual unifying insight):** intra-layer edge
aggregation and inter-layer arrow aggregation are the SAME underlying operation, not two. Both
start from the repo-wide `FileEdge[]` `analyze()` already produces, and both group raw edges by
which rendered item (a file-leaf or a folder-aggregate) each endpoint resolves to AT THE
CURRENT LAYER — then split the result: both endpoints resolve inside the current layer's item
set → intra-layer edge; exactly one resolves outside → inter-layer arrow. This one generalized
"resolve edges against a layer's item boundaries" function replaces what are currently two
separate ad hoc Map-keyed-by-pair implementations — `aggregateFileEdges()`
(`core/src/analyze-micro.ts`, file→file only) and `aggregateToBlockEdges()`
(`core/src/edges/block-aggregate.ts`, file→block only) — neither handles the mixed
file-leaf/folder-aggregate item sets a real layer has once folders and loose files coexist.
Building a third bespoke function for inter-layer arrows, instead of this one shared
generalization, would be exactly the kind of duplicated-formula drift `edge-path.ts`'s
`controlPointOffset()` comment already warns against for a different mechanism — same
principle applies here.

**Layer-stack navigator (decided, replaces the plain breadcrumb):** a small fixed floor-picker
widget docked top-left of the canvas — the same interaction pattern as Google Maps' indoor
floor-level picker: a vertical stack of rounded slab buttons, one per depth level from the
REPO root (layer 0, not a block) down to the current layer, current layer highlighted.
Hovering a slab previews it (name + file/folder count); clicking jumps straight to that depth.
Flat 2D styling (shadow/layering for depth cues), not a 3D perspective scene. `StatusBar.tsx`'s
current two-level breadcrumb (`System Map` / one block name, hardcoded — confirmed, no
multi-level support exists there today) is replaced by this widget, not kept alongside it.

**State implications (corrected):** `GraphView.tsx`'s view-state is a fixed 3-phase machine,
`'macro' | 'diving' | 'micro'` (confirmed, `GraphView.tsx` ~L70) — this generalizes to an
arbitrary-depth stack of active path segments, starting at layer 0 (repo root) rather than
treating the block level as a separate phase before the stack begins; `StatusBar.tsx`'s
breadcrumb prop (hardcoded to exactly one ancestor level, confirmed) is subsumed by the
layer-stack navigator above, not generalized in place.

**State keying, generalized (resolves an open question):** folder-card positions use the
identical global-unique-by-path keying already proven correct for file positions
(`state.ts`'s `filePositions`) — a folder's own repo-relative path as its id, added to the
SAME position map rather than a new one, since a detected block's id is itself already just a
repo-relative path in every case except the synthetic `(root)` block (which no longer needs a
position once its files render inline at layer 0 — see above). `blocknet.filePositions` /
`blocknet.fileEdgeWaypoints` (`extension/src/state.ts`) do NOT need rekeying for files —
confirmed by reading `state.ts`: both are already keyed by full repo-relative file id, globally
unique across every block and folder. An earlier draft of this note claimed they were
block-scoped and at risk of collision; that claim was wrong, checked against the actual code,
and is corrected here. `blocknet.edgeWaypoints` / `blocknet.fileEdgeWaypoints` unify into one
waypoint map for all intra-layer edges by the same reasoning already established for edge ids
(pure function of `(source,target)`, stable across re-analysis, `decisions/`-adjacent finding
from this session) — not two separate maps split by macro/micro, since that split no longer
means anything under the unified model.

**Doc-stack card (decided) — real-repo-motivated, not hypothetical:** this repo's own `docs/`
tree is the exact failure case: a folder with dozens of small one-concept files (CLAUDE.md's
own documentation discipline) would otherwise render as a long vertical pile of near-identical
file-leaf-cards. Within any folder's layer, if its DIRECT children include MORE THAN ONE file
matching a documentation extension (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.adoc` —
extension-only, see below for why), those files collapse into ONE indicator, visually scaled
to count: 2-3 files renders as a compact stacked-card (2-3 overlapping rounded rectangles,
offset, count badge, reusing the SAME stacked-slab visual language as the layer-stack
floor-picker); MORE than 3 renders sized and styled like a full folder-block card (matching
the width/prominence of a real folder-card, not a dispersed small icon among them) — the
visual scales up with volume so a real `docs/`-sized cluster reads as "a meaningful group,"
not clutter, while still being exactly one card, never a pile. Either size uses the IDENTICAL
click behavior: a popover, never a layer dive — this is not a folder-card pretending to be a
folder, it's a compact list surfaced inline. A single loose doc file (count exactly 1) still
renders as an ordinary file-leaf-card; the grouped indicator only replaces what would
otherwise be a real pile. Clicking it opens a fixed-position
overlay popover that MIRRORS THE EXISTING `RiskPopover.tsx` PATTERN exactly (confirmed by
reading it — a lightweight overlay, explicitly NOT the unbuilt v2.1 Connection Inspector),
listing every file in the stack with one row each, a button per row posting
`{type: 'open/file', fileId}` to the host exactly like `RiskPopover`'s evidence rows — opening
the REAL file in the REAL editor (`decisions/0009` unaffected, nothing new rendered in-webview).

**Why extension-only, not "zero import edges":** doc files never appear in `FileEdge[]`
regardless of any heuristic (dependency-cruiser doesn't parse prose), so "zero edges" is NOT a
usable signal here — a genuinely isolated real source file (a leaf utility, a standalone
script with no imports and no importers) also has zero edges and must NOT get swept into a
"docs" bucket just for being edge-less. Classification is extension-only, on purpose.

**Folder-card metadata, generalized:** every folder-card, whether an AD-5-detected block or a
plain subdirectory, shows `fileCount` (its own subtree's real file count) and an aggregated
risk indicator (⚠ if ANY risk exists anywhere in its subtree — same badge language as today's
block risk pill, just recursive instead of one-level). `pills` (category tags like
`frontend`/`api`) stay an AD-5-only concept — a plain subdirectory folder-card shows no pills
row; a bare directory name carries no architectural-category meaning AD-5 never assigned it.

**Inter-layer direction, precise rule (resolves an ambiguity):** "depth" means path-segment
count from repo root, not literal one-hop reachability. Down = target's path has strictly more
segments than the currently-displayed layer's path; up = fewer, OR equal (a cousin branch at
the SAME segment count still shows up, per the earlier rule, since ascent to a common ancestor
is required regardless of the cousin's own depth). This is a directional hint orienting the
user toward "shallower" vs. "deeper" in the stack, not a promise the arrow leads to a direct
child — clicking it always resolves and navigates through the real path regardless of which
way it pointed.

**Known risk, not yet validated:** a layer with many files each pointing to many DISTINCT
off-screen targets could produce visual clutter — one arrow per distinct target is the decided
design, and nothing bounds that count today. No fallback is designed yet. If real-repo
validation (this project's own standing Checkpoint-style discipline) shows this is noisy, the
fallback is folder-level collapsing — all arrows into one off-screen folder's subtree collapse
to a single arrow, mirroring the existing per-node `connectionCounts()` badge pattern
(`graph-derive.ts`) — not designed now, flagged so it isn't a surprise discovered late.

**Inter-layer arrows do not support waypoint dragging** — a static, aggregated indicator
(label + direction + click-to-navigate), not a routable edge. `RiskEdge.tsx`'s ~150 lines of
waypoint-gesture machinery are irrelevant here (confirmed by this session's code survey); a
separate, much smaller component renders inter-layer arrows, sharing only `edge-path.ts`'s
geometry helpers where relevant, not `RiskEdge.tsx` itself.

**Git-dirty markers, generalized (resolves a real gap, checked against the actual code):**
today's two mechanisms are `dirtyBlockIds()` (`extension/src/dirty-blocks.ts:26`, path-prefix
match, called for macro blocks only) and an inlined exact-file-id-membership check
(`extension/src/commands/show-architecture.ts:98-99`, micro files only). `dirtyBlockIds()` is
already genuinely generic — its signature takes `{id, path}[]`, nothing block-specific — so
folder-cards at any layer/depth reuse it unchanged, just called with that layer's folder-cards
instead of only top-level blocks. File-leaf-cards at any layer reuse the existing exact-membership
check unchanged. This also fixes a pre-existing documented gap for free: `dirty-blocks.ts:19-24`'s
own comment notes the synthetic `(root)` block never gets a dirty marker today — once its files
render as file-leaves instead of being wrapped in that block, they pick up a correct marker via
the same exact-membership path every other file-leaf already uses.

**Process-boundary judgment call, flagged for live measurement:** `decisions/0011` mandates
`child_process.fork()` for analysis work, reasoning explicitly from infrequency ("on-save, not
on-keystroke... fork overhead is irrelevant") — that reasoning doesn't automatically extend to
layer navigation, which will be triggered far more often (drilling through folders, floor-picker
clicks) than one block double-click. `itemsForLayer()`/`resolveLayerConnections()` themselves are
pure, fast, synchronous, non-I/O — not the concern; `walkRealFiles()` (a real, synchronous
disk walk `analyze-micro.ts` already calls per micro-dive, calling it "bounded") IS a real
blocking-the-host-thread risk (CLAUDE.md's own extension standard #10) if run in-process,
same reason it's forked today. The whole-repo file list is NOT currently persisted anywhere
(checked `analyze.ts`/`cache/store.ts` — only COUNTS survive past the walk, not the list
itself), so avoiding the walk entirely would mean a real cache-schema change, not a small one.
Decision: mirror the existing, proven `runMicro`/fork pattern exactly for `graph/layer/request`
now (minimal new complexity, reuses tested machinery) rather than build a new persistence
mechanism to solve a latency problem that hasn't been measured yet — "measure, then decide"
cuts against guessing in EITHER direction. Explicitly flagged for the live-verification todo:
if drilling through several folder levels in the REAL extension host (not the Vite dev server,
which never touches the fork path at all) feels sluggish, persisting the walked file list in
the cache payload is the fix, done then, with real data, not now, speculatively.

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

## v2.2 — Agent-agnostic context & query layer

**Status:** planned, not started. BlockNet computes and renders ground truth; it never
hosts an AI conversation itself (`PRINCIPLES.md`'s "We are the map, not the assistant").
Every dev this matters to already has an agent open somewhere (Claude Code, Copilot,
Cursor, whatever) — the gap is that those agents reconstruct cross-file structure via grep,
which misses barrel-file re-exports, path aliases, and dynamic imports; a real import-graph
analyzer resolves all of that correctly, and `core` already is one (`decisions/0002`).

**What, two halves:**
1. **A `blocknet` CLI query surface**, extending the existing `blocknet analyze <path>
   --json` (`core/src/cli.ts` — already ships, zero VS Code deps, already usable by any
   agent today for the block/edge/risk macro layer). New subcommands, scoped and small on
   purpose — not a full-graph dump, so cost stays flat regardless of repo size and results
   stay agent-context-window-friendly:
   - `blocknet trace <file>` — a file's direct import edges (both directions), its block,
     any risk flags touching it directly.
   - `blocknet impact <file>` — full transitive reverse-dependency set (if I change this
     file's public surface, what could break, arbitrarily many hops away).
   - `blocknet path <fileA> <fileB>` — does an import chain exist between two arbitrary
     files (either direction), and what is the actual chain.
   - `blocknet risks` — just the flagged risk edges + evidence (file/line/statement),
     already in the schema (`Risk.evidence`, `DATA-MODEL.md`), just not separately queryable
     today.
2. **User-triggered context handoff from the webview** — clicking a node/edge copies or
   writes a small scoped context payload (the same shape the CLI queries return) for the dev
   to paste into whatever agent session they're already running. Not a chip, not a dock, not
   a chat window rendered by BlockNet — a handoff, not a conversation.

**Engine work this actually requires** (traced against current code, not guessed — see
`docs/planning/PROGRESS-V2.md` for the full trace): `trace` is cheap and mostly wiring —
`fileEdges` (repo-wide, file-granularity) already exists inside `analyze()`
(`core/src/analyze.ts`) and the cache payload (`core/cache/store.ts`), it's just never
exported from `core/src/index.ts` or turned into a queryable shape. `impact` and `path` need
real new code — no transitive-reachability or path-reconstruction traversal exists anywhere
in `core` today (`findCyclicFileEdges` in `core/src/risks/cycles.ts` builds an adjacency map
but for cycle-detection, forward-only, not reverse-reachability or chain-reconstruction —
still a reasonable structural model to build the new traversal on, including its deliberate
explicit-stack-not-recursion style for repos with deep import chains). Both are cheap to
*run* once `fileEdges` is resident in memory from a cached `analyze()` — same O(V+E) order
as the already-proven-safe whole-graph cycle pass — the cost lives in getting `fileEdges` at
all if no cache exists yet (a fresh cruise, same cost `analyze()` itself already pays cold).

**Why this matters beyond TS/JS:** the actual mission this closes a gap on is bigger than
one language — a dev working with an AI agent should never be one grep-guess away from a
wrong mental model of their own codebase, in whatever stack they're in. `core`'s aggregator
design (`decisions/0003`) was chosen specifically so this generalizes — v2.5's Python/LSP
work extends the SAME `fileEdges`/risk model this query layer reads from, not a parallel one.

## v2.2.1 — Flow tracer: animated data-path visualization

**Status:** planned, not started. Depends on v2.2's `impact`/`path` transitive-reachability
traversal — cannot be built before that traversal exists in `core`; sequenced directly after
v2.2, not folded into it and not part of v2.0.1.

**What:** click any block or file card → a "Run flow" affordance. On activation: every node
and edge NOT on a reachable path to/from the clicked node dims to low-opacity grey; every node
and edge that IS on the path stays fully lit, and an animated pulse of light travels along each
lit edge in the actual import direction (source → target) — so a user can watch how data/
imports actually move through the system, not just infer that a connection exists.

**Engine:** reuses v2.2's `impact` (reverse reachability) and `path` (forward reachability)
traversals directly — a rendering mode over data those subcommands already compute, not new
graph analysis. No new core traversal beyond what v2.2 already needs to build.

**Why sequenced after v2.2, not folded into it:** v2.2's traversal IS the data this needs;
building the animation before that traversal exists would mean mocking the same computation
twice. **Why not part of v2.0.1:** that item is structural navigation (folder drill-down,
cross-layer visibility); this is execution/data-flow tracing — different problem, different
UI surface, gated on a different dependency, not bundled just because both touch the canvas.

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
- **Draggable/bendable edge routing:** ✅ shipped. Full multi-point routing — grab the line
  anywhere to drop a new bend, drag any existing bend, drag one back near the straight line
  between its neighbors to remove it. Each handle renders through React Flow's
  `EdgeLabelRenderer`; the full waypoint array persists in `context.workspaceState`
  (`blocknet.edgeWaypoints`, macro; `blocknet.fileEdgeWaypoints`, micro) via `state.ts`'s
  sparse-override pattern. See `docs/planning/PROGRESS-V2.md` for the build record. Two
  edges between the same node pair never render as overlapping curves: `graph-derive.ts`'s
  `siblingOffsets()` gives every such edge (either direction) a distinct, stable rendering
  offset before any waypoint exists.

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
