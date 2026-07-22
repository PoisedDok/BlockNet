# Architecture — Webview Protocol

The webview is a **pure renderer of host state**. It owns only camera/UI state — never the
graph. Everything below crosses through `extension/src/shared/protocol.ts`, designed to be
imported verbatim by both the extension host and the webview so a payload shape cannot drift
between the two sides — there is only one type for it. Both sides import it as of Task 8: the
extension host (`panel.ts`'s `post()`/`onDidReceiveMessage`) since Task 6, and the webview
(`extension/webview/src/host-bridge.ts`) since Task 8 — a relative cross-boundary import, no
workspace-package indirection, confirmed to resolve correctly through both esbuild (host) and
vite (webview), including through vitest's own transform pipeline for tests.

## Messages

| Direction | Message | Payload |
|---|---|---|
| Host → Webview | `graph/macro` | `{ nodes: WebviewBlockNode[], edges: Edge[] }` |
| Host → Webview | `risks/update` | `{ risks: Risk[] }` |
| Host → Webview | `layout/restore` | `{ positions: Record<string,Position>, edgeWaypoints: Record<string,Position[]> }` |
| Host → Webview | `analysis/progress` | `{ phase, done, total }` (from `Progress`) |
| Host → Webview | `graph/layer` | `{ layerPath, items: WebviewLayerItem[], edges: LayerEdge[], arrows: LayerArrow[] }` |
| Host → Webview | `graph/layer/error` | `{ layerPath, message }` |
| Webview → Host | `webview/ready` | `{ generation }` — see "The ready handshake" below |
| Webview → Host | `open/file` | `{ fileId, line? }` → `showTextDocument` (ViewColumn.Beside) |
| Webview → Host | `open/diff` | `{ fileId }` → `vscode.diff` working-tree vs HEAD |
| Webview → Host | `layout/persist` | `{ positions, edgeWaypoints }` — one flat map, every layer |
| Webview → Host | `graph/layer/request` | `{ layerPath }` — a layer navigation (dive, floor-picker jump, or arrow) |

`risks/update` is sent by `commands/show-architecture.ts` alongside `graph/macro` but not
currently consumed by the webview — every risk the UI shows (StatusBar's count, `RiskPopover`)
already comes from `graph/layer`'s own `LayerEdge.risk`/`LayerArrow.risk`/`LayerFileItem.risk`,
the identical underlying `Risk` set `risks/update` would otherwise duplicate. It stays part of
the contract (and the host keeps sending it) as the natural home for a future dedicated
risks-list view (`docs/planning/ROADMAP-V2.md`), not dead protocol — `App.tsx`'s message switch
has an explicit no-op case for it, not a silent drop.

`graph/macro`'s `nodes` are `WebviewBlockNode` (`shared/protocol.ts`: `BlockNode & { dirty:
boolean }`), not core's own `BlockNode` directly — dirty-file state is an extension-host-only
concern (`STATE-OWNERSHIP.md`, `git.ts` + `dirty-blocks.ts`, Task 9) computed fresh on every
push, never something core's frozen Checkpoint-B schema knows about. `commands/show-
architecture.ts`'s `triggerAnalysis` is the one place a plain `BlockNode` gains the field, right
before posting. `graph/layer`'s `items` gain the identical augmentation one level down —
`WebviewLayerItem = LayerItem & { dirty: boolean }` — computed by that same file's
`triggerLayerAnalysis` (see "Layer requests" below).

**`graph/macro`'s own payload is never rendered directly by the webview (v2.0.1, ROADMAP-V2.md's
unified layer model).** Its sole remaining job is to signal that a fresh analysis snapshot
exists — `App.tsx`'s `graph/macro` case issues a `graph/layer/request` in response, which is what
actually populates the mixed block/file/folder view the user sees. On a cold open this is layer
0 (`''`, `currentLayerPathRef`'s initial value); on every subsequent `graph/macro` (a
save-triggered re-analysis), it re-requests whichever `layerPath` is CURRENTLY being viewed —
`currentLayerPathRef` is updated synchronously every time `GraphView.tsx` issues a navigation,
read (never written) by the `graph/macro` handler. This is load-bearing, not incidental:
`GraphView.tsx` only ever applies a `graph/layer` response whose `layerPath` matches its own
current or in-flight layer, so hardcoding a re-request to root would leave a deep layer showing
stale pre-edit data until the user manually backed all the way out and back in — a real bug
found and fixed while building this (`docs/planning/PROGRESS-V2.md`'s v2.0.1 entry). This
two-step bootstrap (wait for `graph/macro`, then fetch a layer) was the deliberately minimal-risk
choice over redefining `graph/macro`'s own wire shape to carry layer data directly — it reuses
`graph/layer`'s existing rendering path for every layer, including the first one, rather than
giving layer 0 a special-cased second code path.

`open/file` is implemented on both sides as of Task 9: `RiskPopover`'s evidence `file:line`
entries post it (`extension/webview/src/ui/RiskPopover.tsx`), and `commands/open-file.ts`
handles it host-side. A `FileCard`'s ⤢ button and a `DocStackPopover` row (`extension/webview/
src/ui/DocStackPopover.tsx`) are further senders — the same `handleOpenFile(rootDir, fileId,
line?)` handles all of them unchanged, since every sender already posts a real repo-relative
file path. `open/diff` stays defined in the protocol but unimplemented on both sides — it still
has no UI trigger anywhere.

## Layer requests

`graph/layer/request` is posted by the webview for every layer navigation — the very first
layer-0 fetch above, a folder dive (`GraphView.tsx`'s `handleDive`), a floor-picker jump
(`FloorPicker.tsx`), or an inter-layer arrow click (`InterLayerArrows.tsx`) — there is no
separate message per navigation trigger; all three resolve to the same `{layerPath}` shape
before posting, since `layerPath` alone is enough for the host to answer identically regardless
of how the user got there (see FLOWS.md's "Layer navigation" flow for why this is required for
correctness, not just convenient).

`commands/show-architecture.ts`'s `triggerLayerAnalysis` handles it: computes items/edges/arrows
for that `layerPath` (`core/src/analyze-layer.ts`'s `analyzeLayer()`, reading the existing
analysis cache — it does not re-run a full analysis) and responds with either `graph/layer`
(success) or `graph/layer/error` (only when there's no cache on disk at all yet —
`analyze-layer.ts`'s own degrade rule). A `layerPath` that no longer resolves to anything in the
cached snapshot — its directory was deleted since the cache was written — is NOT an error:
`itemsForLayer` simply returns an empty boundary set, so the response is still a successful
`graph/layer` with `items: []`, rendered as an empty layer rather than a banner. Unlike a macro
analysis failure (`vscode.window.showErrorMessage`, a global toast), a genuine layer-request
failure (no cache yet) is local to the navigation the user just made, so it's posted back as
`graph/layer/error` instead — the webview falls back to the previous layer with an inline notice
(`GraphView.tsx`) rather than
a global toast plus a webview stuck mid-transition with nothing to correct it.

Gated by its own **independent** generation counter, not macro's: `AnalysisRunner`'s
`#latestLayerGeneration`/`isLatestLayer()` (`analysis-runner.ts`) is a separate stream from
`#latestGeneration`/`isLatest()` — a routine save-triggered macro re-analysis must never
supersede an in-flight, user-driven layer navigation, and vice versa. `triggerLayerAnalysis`
applies the same dual gate `triggerAnalysis` does for macro (`isLatestLayer()` AND
`panel.isCurrentGeneration()`, both re-checked after every await) — the identical stale-post
race Task 9's review found and fixed for `graph/macro` applies identically here.

Dirty markers for a `graph/layer` response reuse `dirty-blocks.ts`'s `dirtyBlockIds()` unchanged
for folder items (it was already generically typed `{id,path}[]`, never block-specific, just
narrowly called until now) and exact-path membership for file items. A `LayerDocStackItem` has
no single path of its own to check against — it's marked dirty if ANY of its own constituent
files is (`triggerLayerAnalysis`'s explicit third branch; see DATA-MODEL.md's field notes for
why omitting this case would have silently always reported `dirty: false` for every doc stack).

**Process-boundary note** (ADR-0011): a layer request forks a worker exactly like a macro
analysis does (`core/src/ipc-worker.ts`'s `'layer'` request kind), reusing the existing
fork-per-request machinery rather than a new caching mechanism, even though layer navigation
(drilling, floor-picker clicks) is far more frequent than the "on-save, not on-keystroke"
reasoning ADR-0011 was written against. This is a deliberate measure-then-decide call, not an
oversight — flagged for live-verification measurement before optimizing (`docs/planning/
ROADMAP-V2.md`), not resolved speculatively now.

## The ready handshake

VS Code drops any `postMessage` sent before the webview's own
`window.addEventListener('message', ...)` has registered — there is no queue, and a message
sent too early is simply gone. `panel.ts` reassigns `webview.html` on every
`createOrReveal('ready', ...)` call (construction **and** reveal — this doesn't special-case
"already showing this state," so every call is a fresh navigation, a fresh script instance,
and a fresh listener-registration race), so the host cannot assume any fixed delay is safe.

The webview's `App.tsx` posts `webview/ready` as the first thing it does after subscribing to
`window.addEventListener('message', ...)` — before that, it does nothing else. `panel.ts`'s
`whenReady(): Promise<void>` resolves the first time it observes `webview/ready` on the current
webview instance; `commands/show-architecture.ts` awaits it before posting anything.
`'no-workspace'`/`'multi-root'` panel states never resolve `whenReady()` (`enableScripts:
false` — no script ever runs to post it), so this handshake only applies to the `'ready'`
state.

## Ordering guarantee

On panel creation, `layout/restore` is always sent **before** `graph/macro`, gated on the
ready handshake above, so the first paint has persisted positions available and never flashes
a default layout that then jumps. Implemented in `commands/show-architecture.ts`:
`panel.whenReady().then(() => { panel.post({type: 'layout/restore', ...}); triggerAnalysis(...) })`.
Positions come from `state.ts`'s `getPositions()` (`context.workspaceState`) — a sparse map of
only the ids a user has actually moved or previously restored, never a full snapshot of any
layer's own computed layout (see `flow/layer-layout.ts`'s own header comment for why that
distinction is load-bearing, not cosmetic).

## State keying, generalized (ROADMAP-V2.md)

`layout/restore` and `layout/persist` each carry exactly ONE flat `positions` map and ONE flat
`edgeWaypoints` map, spanning every item (block, plain folder, file, or doc stack) and every
intra-layer edge at every depth — the retired macro/micro split's four separate maps
(`positions`/`edgeWaypoints`/`filePositions`/`fileEdgeWaypoints`) are gone. This is safe because
every id is already globally unique by repo-relative path (a file, folder, or block's `id` is
always its own path; a doc stack's `id` is derived from its layer path, never colliding with a
real file/folder path) — a single flat map can't collide across layers the way a naive
per-layer-scoped key scheme would need to guard against. `state.ts`'s
`getPositions`/`setPositions`/`getEdgeWaypoints`/`setEdgeWaypoints` read/write two
workspaceState keys, `blocknet.positions`/`blocknet.edgeWaypoints`, globally scoped exactly as
described here — not one key per layer.

Inter-layer arrows (`LayerArrow`, DATA-MODEL.md) are never persisted at all — they're a pure
function of the current layer's items plus the full edge set (`resolveLayerConnections()`,
recomputed fresh on every `graph/layer` response), not draggable, and carry no independent
identity worth remembering across a save.

## Draggable, multi-point edge waypoints (ROADMAP-V2.md)

Each PRESENT `edgeWaypoints` value is an ORDERED ARRAY of zero-or-more bend points
(`Position[]`, not a single `Position`) — the original design supported exactly one waypoint per
edge; this was fully redesigned to a multi-point model the same day, after real usage (both
automated and a live user session) exposed that a single fixed midpoint wasn't enough for real,
tangled repo graphs. `camera-store.ts`'s `useCameraStore` owns both maps together in the
webview, sharing ONE debounced `layout/persist` send (300ms) so a position drag and a waypoint
drag close together in time coalesce into one write instead of racing as two
independently-debounced ones. As of the unified layer model, `LayerCanvas.tsx` is the single
canvas component every layer mounts — there is no longer a separate macro-canvas/micro-canvas
split, so this one `useCameraStore` instance and its one debounced send now cover every layer a
user visits in a session, not just the top one.

**The interaction**: a user grabs the edge's own rendered LINE directly, anywhere along it — not
a separate, always-visible handle widget — via a new invisible, wide (`22px` stroke)
`<path className="bn-edge-grab">` sibling to the visible `BaseEdge` path, carrying its own
pointerdown/move/up handlers (`RiskEdge.tsx`). Pressing and dragging past a small screen-space
threshold (`INSERT_MOVE_THRESHOLD_PX`, 4px — deliberately screen-space, not flow-space, so the
"did the user mean to drag" feel stays constant at any zoom) inserts a new waypoint at the
pressed point, found via `edge-path.ts`'s `nearestPointOnEdgePath()` (samples every current
cubic segment, 24 points each, and returns both the closest on-curve point AND the correct
array-splice index for that segment — no closed-form nearest-point solution exists for a cubic
bezier, so sampling is the standard, sufficient technique). A plain click with no real movement
still reaches React Flow's own native `click` event for edge selection normally — the
synthetic-event `stopPropagation()` in the pointer handlers only suppresses the pane's own
pan-on-drag gesture, never the separate native click. Existing waypoints each get their own
small (14px) drag handle, rendered through React Flow's `EdgeLabelRenderer` (a portal into a
shared HTML overlay layer above all edges' SVG) rather than inline SVG — an SVG circle nested
in the edge's own `<g>` was tried first and found, via live Playwright testing, to lose
hit-testing to a DIFFERENT, unrelated edge's own wide invisible interaction stroke (SVG paint
order is document-order across the whole graph, not scoped per-edge). Handles counter-scale by
`1/zoom` (`useViewport()`) to stay a constant grabbable size at any zoom. Dragging an existing
point back onto the straight line between its two neighbors (source/prior-waypoint and
next-waypoint/target — `edge-path.ts`'s `distanceToSegment()`, threshold `REMOVE_DISTANCE` =
14 flow-space px) removes it — the multi-point generalization of the original design's single
"drag back to the midpoint to reset" gesture. Both risky (red) and plain (white) edges get the
byte-identical interaction — `RiskEdge.tsx` has exactly four uses of `isRisk`, all purely
cosmetic (the `data-risk` CSS hook, the conditional "!" badge, and the badge/handle color), zero
branching in any geometry or gesture-handling code. `RiskEdge.css` raises
`.react-flow__edgelabel-renderer`'s `z-index` above React Flow's own default (which otherwise
paints every node card above every edge label, burying a handle under any node its edge visually
passes beneath).

**Automatic separation for parallel/anti-parallel edges** (`graph-derive.ts`'s
`siblingOffsets()`): two edges between the SAME pair of nodes — in EITHER direction, so a
reciprocal A→B/B→A import-cycle pair (this tool's own single most common risk pattern) counts —
otherwise render as literally coincident curves. Worse than a cosmetic overlap: because a
"backwards" (right-to-left, relative to the LR layout) edge's curve stays close to the same y as
a "forward" one between the same two nodes across its ENTIRE span (see the control-point cap
below), the two edges don't just touch at one point, they visually overlap along their whole
shared length — confirmed live, a drag aimed at one edge could silently grab and bend the OTHER
one instead. `siblingOffsets()` groups edges by their UNORDERED `{source,target}` pair (a stable
`Array.prototype.sort` on the two-element pair, not Map-iteration order) and assigns each a
symmetric perpendicular Y offset (two edges: ∓22 flow px; three: -44/0/+44; …). Applied as an
IMPLICIT single waypoint in `RiskEdge.tsx` (`implicitPoint`) only when the edge has no REAL
waypoints yet — purely a rendering bias, never itself persisted — via a `basePoints()` helper
that every gesture handler reads through instead of the raw `data.waypoints` prop, so the
implicit point "realizes" into a real, persisted waypoint the moment a user's gesture actually
touches it (drags it, or clicks through the insert-threshold near it), and stays purely visual
otherwise. A lone edge between its two nodes (the common case) always gets offset 0 — zero
change from before this system existed. `resolveLayerConnections()`'s `LayerEdge` ids are
computed the same deterministic way at every layer (`edges/layer-connections.ts`'s
`pairKey`/aggregation), so `siblingOffsets()` groups correctly regardless of which layer is
currently mounted.

**`edge-path.ts`'s control-point offset is capped, not just floored.** `dx =
Math.min(220, Math.max(52, Math.abs(tx - sx) * 0.5))` — the floor (52) keeps close nodes'
curves visibly bowed; the cap (`MAX_CONTROL_POINT_OFFSET`, added the same session) is the real
fix for a live-caught bug: uncapped, a real 618px-apart BACKWARDS edge computed a control-point
offset of 309, pushing control points to x=924 and x=-312 — hundreds of px past either node.
Invisible at rest (a same-y source/target keeps the curve visually flat regardless of how
extreme its control points are), but the instant any waypoint gave that edge a y-offset, it
bulged into a huge, visibly self-crossing loop.

**Five other real, live-reproduced bugs found and fixed while building this**, beyond the
control-point cap and sibling-offset system above:
1. A near-miss on an existing waypoint's own small hit target created a brand-new duplicate
   point beside it instead of moving the existing one — repeated attempts on the same edge (the
   natural result of testing a new feature more than once) compounded into a self-crossing,
   tangled curve. Fixed with `SNAP_TO_EXISTING_PX` (20 screen px, generously larger than the
   14px handle itself): `onPathPointerDown` checks proximity to every existing waypoint FIRST
   and grabs the nearest one within range instead of computing an insert.
2. A stale-closure bug: gesture logic read `waypoints` from the React prop/closure instead of a
   live-updated ref, and nothing guarantees a re-render happens between one pointermove and the
   next (or the last pointermove and the following pointerup) — producing either a wrongly
   computed removal (comparing against a pre-drag position) or a crash (checking removal for an
   index that doesn't exist in the stale array). Fixed with a `liveWaypoints` ref, written to
   synchronously by an `emit()` wrapper every time the component itself changes the array, never
   dependent on React having re-rendered in between.
3. The risk edge's decorative "!" badge (`aria-hidden`, but not `pointer-events: none`)
   intercepted pointerdown meant for the grab path underneath it — and specifically at an edge's
   natural (unbent) midpoint, exactly where a first drag is most likely to be attempted. Fixed
   with `pointer-events: none` on `.bn-edge-badge`.
4. A CSS specificity bug, found by live interactive testing rather than a unit test: selecting a
   risky edge (by click, or by ending a drag) turned it gray instead of staying red.
   `@xyflow/react`'s own base stylesheet ships
   `.react-flow__edge.selected .react-flow__edge-path { stroke: #555 }` at the IDENTICAL (0,3,0)
   specificity as this project's `.bn-edge[data-selected] .bn-edge-line`, which never explicitly
   redeclared `stroke` — the tie was resolved by CSS import order, and React Flow's own
   stylesheet happened to load later. Fixed by explicitly declaring `stroke` in both
   `.bn-edge[data-selected] .bn-edge-line` and the higher-specificity (0,4,0)
   `.bn-edge[data-risk][data-selected] .bn-edge-line`, so selection color no longer depends on
   import order at all.

## Why one file, not two

If `extension/src/protocol.ts` and `extension/webview/src/protocol.ts` each declared their
own copy of `HostMessage` / `WebviewMessage`, a change to one side's payload could silently
stop matching the other — a bug that only surfaces at runtime, never at compile time.
`shared/protocol.ts` is set up so both build targets include it (esbuild for the host, vite
for the webview — both bundlers resolve relative imports across the `extension/` directory
boundary without any workspace-package indirection), so a payload change is a compile error on
both sides at once — confirmed, not assumed: every layout module also imports `Position` from
here rather than declaring its own structurally-identical duplicate, and both `tsc --noEmit` and
`vitest run` (which transforms through the same vite pipeline as the real build) pass clean.
