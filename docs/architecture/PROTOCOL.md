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
| Host → Webview | `layout/restore` | `{ positions, edgeWaypoints, filePositions, fileEdgeWaypoints: Record<string,{x,y}> }` |
| Host → Webview | `analysis/progress` | `{ phase, done, total }` (from `Progress`) |
| Host → Webview | `graph/micro` | `{ blockId, files: WebviewMicroFileNode[], edges: MicroFileEdge[] }` |
| Host → Webview | `graph/micro/error` | `{ blockId, message }` |
| Webview → Host | `webview/ready` | *(none)* — see "The ready handshake" below |
| Webview → Host | `open/file` | `{ fileId, line? }` → `showTextDocument` (ViewColumn.Beside) |
| Webview → Host | `open/diff` | `{ fileId }` → `vscode.diff` working-tree vs HEAD |
| Webview → Host | `layout/persist` | `{ positions, edgeWaypoints }` — macro graph only |
| Webview → Host | `layout/file-persist` | `{ filePositions, fileEdgeWaypoints }` — micro (file) graph only |
| Webview → Host | `graph/micro/request` | `{ blockId }` — a block double-click |

`risks/update` is sent by `commands/show-architecture.ts` alongside `graph/macro` but not
currently consumed by the webview — every risk the UI shows (StatusBar's count, `RiskPopover`)
already comes from `graph/macro`'s own `Edge.risk`, the identical `Risk` objects `risks/update`
would otherwise duplicate. It stays part of the contract (and the host keeps sending it) as
the natural home for a future dedicated risks-list view (`docs/planning/ROADMAP-V2.md`), not
dead protocol — `App.tsx`'s message switch has an explicit no-op case for it, not a silent
drop.

`graph/macro`'s `nodes` are `WebviewBlockNode` (`shared/protocol.ts`: `BlockNode & { dirty:
boolean }`), not core's own `BlockNode` directly — dirty-file state is an extension-host-only
concern (`STATE-OWNERSHIP.md`, `git.ts` + `dirty-blocks.ts`, Task 9) computed fresh on every
push, never something core's frozen Checkpoint-B schema knows about. `commands/show-
architecture.ts`'s `triggerAnalysis` is the one place a plain `BlockNode` gains the field, right
before posting.

`open/file` is implemented on both sides as of Task 9: `RiskPopover`'s evidence `file:line`
entries post it (`extension/webview/src/ui/RiskPopover.tsx`), and `commands/open-file.ts`
handles it host-side. As of v2.0 (`ROADMAP-V2.md`'s micro view), `FileCard`'s ⤢ button
(`extension/webview/src/flow/FileCard.tsx`, wired in `FileCanvas.tsx`) is a second sender —
the file-level target the original block-card ⤢ never had (a block is always a directory,
`BlockNode.path`, never a single file; a `MicroFileNode.id` always is one). `commands/
open-file.ts` needed no changes at all for this — the same `handleOpenFile(rootDir, fileId,
line?)` handles both senders unchanged. `open/diff` stays defined in the protocol but
unimplemented on both sides — it still has no UI trigger anywhere, block or file level.

## Micro (file-level) requests

`graph/micro/request` (a block double-click, `GraphView.tsx`'s `handleDive`) triggers
`commands/show-architecture.ts`'s `triggerMicroAnalysis`, which forks a worker in `'micro'`
mode (`core/src/ipc-worker.ts`, `PROCESS-BOUNDARY.md`) and responds with either `graph/micro`
(success) or `graph/micro/error` (no cache yet, or a stale `blockId` no longer in the cached
snapshot — `core/src/analyze-micro.ts`'s own degrade rule). Unlike a macro analysis failure
(`vscode.window.showErrorMessage`, a global toast), a micro failure is local to the block the
user just dove into, so it's posted back as `graph/micro/error` instead — the webview falls
back to the macro view with an inline banner (`GraphView.tsx`) rather than a global toast plus
a webview stuck mid-transition with nothing to correct it.

Gated by its own **independent** generation counter, not macro's: `AnalysisRunner`'s
`#latestMicroGeneration`/`isLatestMicro()` (`analysis-runner.ts`) is a separate stream from
`#latestGeneration`/`isLatest()` — a routine save-triggered macro re-analysis must never
supersede an in-flight, user-driven micro request, and vice versa. `triggerMicroAnalysis`
applies the same dual gate `triggerAnalysis` does for macro (`isLatestMicro()` AND
`panel.isCurrentGeneration()`, both re-checked after every await) — the identical stale-post
race Task 9's review found and fixed for `graph/macro` applies identically here. The webview
adds a third, client-side layer on top: `GraphView.tsx` compares an incoming `graph/micro`/
`graph/micro/error`'s `blockId` against its own local `pendingBlockId`, discarding a late
response for a block the user has since navigated away from (backed out, or dove into a
different block) even if it somehow survived both host-side gates.

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
only the ids a user has actually moved or previously restored, never a full snapshot of
`layout.ts`'s dagre output (see `layout.ts`'s own header comment for why that distinction is
load-bearing, not cosmetic).

## Draggable, multi-point edge waypoints (ROADMAP-V2.md)

`layout/restore` and `layout/persist` both carry a second sparse-override map, `edgeWaypoints`,
alongside `positions` — an edge id absent from it falls through to its plain geometric curve,
the identical "sparse, not a full snapshot" contract `positions` already establishes. Each
PRESENT value is an ORDERED ARRAY of zero-or-more bend points (`Position[]`, not a single
`Position`) — the original design supported exactly one waypoint per edge; this was fully
redesigned to a multi-point model the same day, after real usage (both automated and a live
user session) exposed that a single fixed midpoint wasn't enough for real, tangled repo graphs.
`state.ts`'s `getEdgeWaypoints`/`setEdgeWaypoints` read/write it from a separate
`blocknet.edgeWaypoints` workspaceState key (not folded into the positions map, so the two
concerns stay independently readable/testable). `camera-store.ts`'s `useCameraStore` owns both
maps together in the webview, sharing ONE debounced `layout/persist` send (300ms) so a position
drag and a waypoint drag close together in time coalesce into one write instead of racing as two
independently-debounced ones.

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
passes beneath). Originally scoped to `BlockCanvas.tsx`'s macro graph only; `FileCanvas.tsx`'s
micro-view edges gained the identical `onWaypointsChange` wiring in the file-level drag parity
section below — `RiskEdge.tsx` itself is unchanged, reused verbatim by both canvases.

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
change from before this system existed.

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

## File-level drag parity (ROADMAP-V2.md)

File cards and micro-edge waypoints in `FileCanvas.tsx` drag and persist the same way blocks
and macro edges do in `BlockCanvas.tsx` — same `applyNodeChanges` controlled-mode node-drag
lifecycle, same `RiskEdge.tsx`/`WaypointHandle` component for edge bending. Two things differ
from the macro case, both load-bearing:

**A second, independent `useCameraStore` instance, owned by `GraphView.tsx`, not
`FileCanvas.tsx`.** `FileCanvas` fully unmounts and remounts on every dive into a block — even
a re-dive into the *same* block, since `GraphView.tsx`'s `handleBack` tears down
`<FileCanvas>` entirely (`microMounted` → `false`) rather than hiding it. Only a component
that survives that remount boundary for the panel's whole session can preserve a same-session
drag across a "drag a file, go back to the map, dive back into the same block" round trip —
`GraphView.tsx` is that component; `FileCanvas.tsx` itself is not. This second hook instance
persists via `layout/file-persist`, a message distinct from `BlockCanvas.tsx`'s own
`layout/persist` — see `camera-store.ts`'s own header comment for why these stay two
independent hooks/messages (disjoint workspaceState keys, no need to write them atomically
together) rather than more fields bolted onto one shared shape. `state.ts`'s
`getFilePositions`/`setFilePositions`/`getFileEdgeWaypoints`/`setFileEdgeWaypoints` read/write
two new keys, `blocknet.filePositions`/`blocknet.fileEdgeWaypoints`, mirroring
`getPositions`/`setPositions`'s sparse-override contract exactly.

**A real, live-reproduced React Flow bug this split architecture creates, and its fix.**
Because `GraphView.tsx`'s file-camera-store updates its own React state on *every*
`onPositionChange` call — every drag frame, not just at drag end — a naive implementation
that fed that live state straight back into `FileCanvas`'s `initialPositions` prop, reactively
included in the memo that seeds each node's starting position, recomputed that memo's object
identity on every single frame of a drag. React Flow's own internal drag-state tracking does
not tolerate an externally-driven reset of its managed nodes array mid-gesture: this produced
React Flow's error #015 ("trying to drag a node that is not initialized") firing repeatedly,
with visible flicker, confirmed live via Playwright (not merely reasoned about) — the exact
"controlled mode must go through `applyNodeChanges`, never a hand-rolled reset" lesson
`BlockCanvas.tsx`'s own header comment already documents, encountered again one layer up. The
fix: `FileCanvas.tsx` captures `initialPositions` via `useState`'s **lazy initializer**
(`const [seedPositions] = useState(initialPositions)`) — read once, at mount, never updated
again for that mount's lifetime. Since `FileCanvas` always fully remounts on a fresh dive, a
mount-time-only capture already *is* "whatever `GraphView`'s camera store last knew," with no
risk of a live per-frame feedback loop. (An earlier attempt used a `ref` updated via a
`useEffect` instead of `useState`'s lazy initializer — functionally equivalent, but reading a
ref's `.current` inside a `useMemo` factory runs during render, which the `react-hooks/refs`
lint rule correctly flags as unsafe in general; plain state read during render has no such
hazard.) Edge waypoints have no equivalent gap: `RiskEdge.tsx`'s `WaypointHandle` has no
internal drag-state machine of its own to desync from — it's a portaled div whose position is
a pure function of the `data.waypoint` prop on every render, so `flowEdges`'s `initialEdgeWaypoints`
dependency stays a normal, live-reactive one (matching `BlockCanvas.tsx`'s own edge handling).

## Why one file, not two

If `extension/src/protocol.ts` and `extension/webview/src/protocol.ts` each declared their
own copy of `HostMessage` / `WebviewMessage`, a change to one side's payload could silently
stop matching the other — a bug that only surfaces at runtime, never at compile time.
`shared/protocol.ts` is set up so both build targets include it (esbuild for the host, vite
for the webview — both bundlers resolve relative imports across the `extension/` directory
boundary without any workspace-package indirection), so a payload change is a compile error on
both sides at once — confirmed, not assumed: `layout.ts` also imports `Position` from here
rather than declaring its own structurally-identical duplicate, and both `tsc --noEmit` and
`vitest run` (which transforms through the same vite pipeline as the real build) pass clean.
