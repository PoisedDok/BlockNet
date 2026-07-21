# BlockNet v2 — Progress Tracker

**Companion doc:** [PROGRESS.md](./PROGRESS.md) — v1's identical-purpose tracker, left closed
out and untouched. This file starts fresh for v2 rather than appending to a doc titled "v1
Progress Tracker" (`docs/planning/ROADMAP-V2.md` is the backlog/spec; this is the build log).

## Status at a glance

| Item | Status |
|---|---|
| v2.0 — Micro view | ✅ Shipped 2026-07-21. Real-repo verification done same day — see below. |
| Draggable/bendable edge routing | ✅ Shipped 2026-07-21, same day as scoped — see below. |
| Multi-point waypoint redesign + file-level drag parity | ✅ Shipped 2026-07-21, same day — see below. |

## v2.0 — Micro view: dive into a block ✅ (2026-07-21)

**What got built**, per `ROADMAP-V2.md`'s v2.0 spec (double-click a block → cross-fade to its
file-level graph: file cards with real LOC, `● edited` git-dirty marker, ⚠ risk pill, ⤢
split-screen open; breadcrumb `System Map / <block>`; "← zoom out to map" button):

- **`core/src/analyze-micro.ts`** (new): `analyzeMicroBlock({rootDir, cacheDir, blockId})` —
  computes a single block's file-level graph entirely from the last macro run's on-disk cache
  (`cache/store.ts`'s persisted `fileEdges` + `snapshot`), never a fresh dependency-cruiser
  cruise. Enumerates the block's own files via a directory walk scoped to just that
  subdirectory (`walkRealFiles`, prefixed back to rootDir-relative paths) — or, for the
  synthetic `(root)` catch-all block, a whole-repo walk filtered to files `resolveBlock()`
  assigns nowhere else, the identical definition `analyze.ts`'s `computeBlockShape()` uses.
  Real LOC via a trailing-newline-aware line count. Risk flags are computed, not guessed: a
  file/intra-block-edge is risky if it participates in an intra-block import cycle
  (`risks/cycles.ts`'s `findCyclicFileEdges` re-run **unfiltered** over the cached fileEdges —
  `risks/index.ts` itself only keeps the crossing portion for the macro graph, deliberately
  leaving intra-block cycles undetected there; this is exactly that territory, closing a gap
  that module's own header comment already named), or is the source file of an existing
  cross-block `Risk` whose `source` is this block (`Risk.evidence[].file`, already real and
  validated — never a guess at which file on the *target* side of a `BOUNDARY` risk was hit,
  since `Evidence` has no `targetFile` field to answer that honestly). Degrades to `undefined`
  (never a crash) when no cache exists yet or `blockId` no longer matches the cached snapshot.
  8 new tests (`core/test/analyze-micro.test.ts`): the checked-in monorepo fixture's real
  BOUNDARY-risk file attribution, a dedicated intra-block-cycle temp-dir fixture (proving this
  really is new territory — the identical repo's macro-level `risks` array stays empty), an
  unrelated same-block file staying non-risky, and the `(root)` block's file-list scoping. (3
  more tests, and 2 real bugs in the code these first 8 didn't catch, came from same-day
  real-repo verification — see "Real-repo verification" below; 11 total in this file now.)
- **`core/src/types.ts`**: `MicroFileNode`, `MicroFileEdge`, `MicroGraphResult` — three new
  types (core now defines thirteen total, `DATA-MODEL.md` updated).
- **`core/src/ipc-worker.ts`**: `WorkerRequest` gained a `mode: 'macro' | 'micro'`
  discriminant (`MacroWorkerRequest`/`MicroWorkerRequest`); `WorkerMessage` gained
  `'micro-result'`. A missing/stale-block micro request surfaces as a structured `'error'`
  message (never a hang), matching the existing convention. `analysis-runner.ts`'s `run()`
  now always sends `mode: 'macro'` — the only caller-visible change to the existing macro path
  (its `RunOptions` public API is unchanged).
- **`extension/src/analysis-runner.ts`**: `runMicro()`/`isLatestMicro()` — a **second,
  independent** generation counter/namespace (`#latestMicroGeneration`, separate from macro's
  own `#latestGeneration`) so a routine save-triggered macro re-analysis can never supersede
  an in-flight, user-driven micro request, or vice versa. Same one-shot fork lifecycle as
  `run()`, same child-tracking set for `dispose()`. 4 new tests.
- **`extension/src/shared/protocol.ts`**: `WebviewMicroFileNode` (`MicroFileNode & {dirty:
  boolean}`, the same protocol-layer-augmentation pattern Task 9 established for
  `WebviewBlockNode` — dirty state stays extension-host-only, never a core schema change).
  New `HostMessage` variants `graph/micro`/`graph/micro/error`; new `WebviewMessage` variant
  `graph/micro/request`.
- **`extension/src/panel.ts`**: `createOrReveal`/the constructor take a third callback,
  `onMicroRequest`, dispatched on `graph/micro/request`. No-op wired for the two degrade
  states (no script ever runs there to send it), same posture as the existing two callbacks.
- **`extension/src/commands/show-architecture.ts`**: `triggerMicroAnalysis` — mirrors
  `triggerAnalysis`'s dual-generation gate exactly (`runner.isLatestMicro()` AND
  `panel.isCurrentGeneration()`, both re-checked after every await, the identical
  stale-post-race fix Task 9's review found and fixed once already for `graph/macro`).
  Deliberately does **not** use `vscode.window.showErrorMessage` for a micro failure — it's
  local to the block just dove into, not a whole-panel failure, so it posts
  `graph/micro/error` instead, letting the webview fall back to macro with an inline notice.
- **Webview** (`extension/webview/src/flow/`): `GraphView.tsx`/`.css` (new) owns the
  macro↔micro cross-fade — both `BlockCanvas` and a new `FileCanvas` are real, independent,
  permanently-mounted `ReactFlow` instances, cross-faded via CSS opacity+transform, never one
  canvas re-themed as the other. Deliberately does **not** optimistically cross-fade the
  instant a double-click fires (the prototype could, since its data was static/local; a real
  host round-trip is genuinely async) — macro stays fully interactive with a small loading
  indicator until `graph/micro`/`graph/micro/error` actually arrives, then cross-fades. A
  client-side third gating layer on top of the host's dual generation check: compares an
  incoming response's `blockId` against local `pendingBlockId`, discarding a late one for a
  block the user has since navigated away from. `FileCanvas.tsx`/`.css`, `FileCard.tsx`/
  `.css`, `FileNode.tsx` (new) mirror `BlockCanvas`/`BlockCard`/`BlockNode`'s existing shapes
  at file granularity; no risk popover for micro edges (`MicroFileEdge.risk` is a boolean, not
  a full `Risk` with `oneLine`/`explain`/`fix`/`evidence` — deliberately narrower than the
  macro graph's edges, not an oversight). `file-layout.ts` (new) is its own small dagre LR
  layout function, not a shared generic with `layout.ts` — file cards render smaller than
  block cards and there's exactly one caller on each side; three similar lines beat a
  premature abstraction here. `graph-derive.ts`'s `relatedIds()` widened to a generic
  `{id,source,target}` edge shape (was fixed to `CoreEdge`) so `FileCanvas.tsx` reuses the
  identical selection-dims-the-rest logic with `MicroFileEdge[]`, rather than duplicating it.
  `BlockCanvas.tsx` gained `onBlockDoubleClick` (wired to React Flow's `onNodeDoubleClick`).
  `StatusBar.tsx`/`.css` gained an optional `breadcrumb` prop (`FileCanvas.tsx` only — a
  block canvas has no parent block to name); its risk count reflects risky *files* when a
  breadcrumb is passed, risky *edges* otherwise (different views, deliberately different
  metrics). `App.tsx`: `LiveApp` now forwards `graph/micro`/`graph/micro/error` into
  `GraphView`'s `micro`/`microError` props and wires `onRequestMicro` to `postToHost`; the
  `?sample=1`/`?stress=1` dev/QA fixture bypass gained a `FixtureApp` wrapper that resolves a
  double-click against a static per-block dataset through a `setTimeout` (never touching
  `host-bridge.ts`, which no-ops outside a real webview — this is what let the whole flow,
  including the loading state and cross-fade, be verified live via Playwright without a real
  VS Code host). `sample-graph.ts` gained `sampleMicroByBlock` covering a real intra-block
  cycle, a dirty+cross-block-risk file, and a risk-free block with no intra-block edges in one
  dataset; `stress-graph.ts` gained a minimal `stressMicroByBlock` (block-0 only — full
  per-block-of-30 fixtures aren't needed to verify the mechanics, and micro-at-stress-scale is
  its own future perf question per `ROADMAP-V2.md`'s own note, not answered here). 30 new
  tests across `FileCard.test.tsx`, `FileCanvas.test.tsx`, `GraphView.test.tsx`,
  `file-layout.test.ts`, plus 2 added to `BlockCanvas.test.tsx`.
- **Docs**: `DATA-MODEL.md`, `PROTOCOL.md` (new "Micro (file-level) requests" section),
  `LAYERS.md`, `FLOWS.md` (new flow 5), `STATE-OWNERSHIP.md`, `DIRECTORY-TREE.md` all updated
  in the same turn as the code. `ROADMAP-V2.md` got a small, targeted status note under the
  v2.0 heading (shipped, points here) — not a rewrite, matching the file's own "moved
  verbatim" constraint.

**Real, live-verified bugs found and fixed this session** (neither unit tests nor the
two-pass review below caught these first — real-browser Playwright verification against the
actual `vite dev` server did, the same lesson Task 8 already taught this project once):

1. **React Flow's `zoomOnDoubleClick` default (`true`) silently ate every block double-click.**
   `BlockCanvas.tsx`'s `<ReactFlow>` never overrode it, so d3-zoom's own `dblclicked` handler
   (bound directly to the pane) called `event.stopImmediatePropagation()` — confirmed by
   reading `d3-zoom`'s source (`noevent()` in `node_modules/d3-zoom/src/noevent.js`) — before
   the same native event ever reached React's synthetic `onNodeDoubleClick` listener. A real
   double-click just zoomed the canvas; `onBlockDoubleClick` never fired. `BlockCanvas.test.tsx`
   never caught this because jsdom's `fireEvent.doubleClick` dispatches a synthetic `dblclick`
   directly, never exercising d3-zoom's actual attached native listener at all. Fixed:
   `zoomOnDoubleClick={false}` on the macro canvas only (`FileCanvas` keeps the default —
   double-click-to-zoom is still desirable there, since files have no further drill-down).
   Confirmed via Playwright against the real dev server, with a regression test added
   (`BlockCanvas.test.tsx`'s two new `onBlockDoubleClick` cases).
2. **`FileCard`'s file name could render at literally 0px width.** A classic flexbox pitfall:
   `overflow: hidden` on a flex item with no explicit `min-width` resolves its effective
   `min-width` to `0` (not `auto`'s usual min-content size), so when the row's other elements
   (⤢ button, LOC badge, dirty marker, risk pill) didn't all fit, the name — the only
   shrinkable item — shrank all the way to invisible instead of ellipsizing. Confirmed live,
   not reasoned about: `guard.ts`/`auth-client.ts` (the risk-pill-bearing cards, least free
   row space) rendered with a computed width of `0px`; `index.ts`/`routes.ts` (no risk pill)
   rendered fine — same markup, same CSS, only the sibling mix differed. First fix attempt
   (a `min-width: 44px`) closed the invisible-text bug but the row still visually overlapped
   once the name was long enough — the real fix was splitting the name+⤢ row from a separate
   wrapping badges row (`flex-wrap: wrap`), not a magic card-width number chasing whatever the
   fixture's file names happened to be. `BlockCard.css` got the same defensive `min-width`
   fix pre-emptively (identical latent pattern, not yet reproduced there — real block
   names/pills fit v1's fixtures so far, but it's the same failure mode).

**Two-pass adversarial review** (doc-consistency + architectural-soundness, run in parallel per
CLAUDE.md's verification ritual, scoped to every new/changed file this round) — **both lanes
found real bugs, all fixed, all independently re-verified before being trusted:**

- **Doc-consistency lane:**
  1. **Real bug, fixed:** `docs/architecture/PROCESS-BOUNDARY.md` — never updated for the new
     `mode: 'macro' | 'micro'` discriminant or the `'micro-result'` message, even though
     `PROTOCOL.md`, `FLOWS.md`, and `LAYERS.md` all cite it as the mechanism. Fixed: its
     contract table and sequence diagram now cover both modes explicitly.
  2. **Real bug, fixed:** `docs/architecture/README.md`'s index still said "ten core types" —
     `DATA-MODEL.md` correctly says thirteen. Fixed.
  3. Checked and ruled out: every other cross-reference (`DATA-MODEL.md` ↔ `PROTOCOL.md` ↔ the
     actual TypeScript in `core/src/types.ts`/`shared/protocol.ts`), `FLOWS.md`'s "five flows"
     framing, `ROADMAP-V2.md`'s edit being a small targeted note (not a rewrite), every
     `DIRECTORY-TREE.md` annotation for a new/changed file, and this doc's own test-count
     claims — all independently verified against the actual files/grep output, not trusted on
     the reviewer's word.
- **Architectural-soundness lane:**
  1. **Real bug, fixed (the serious one):** `GraphView.tsx`'s two response-handling effects
     (`micro` arriving, `microError` arriving) only cancelled their scheduled timer as a side
     effect of the SAME guard passing again on a later run — never unconditionally. Diving into
     block A, letting A's `graph/micro` arrive (scheduling its two-tick mount-then-flip timer
     chain), then diving into block B **before** A's timers fired: the effect re-ran with a
     changed `pendingBlockId`, its guard now failed, and it returned *before* ever reaching the
     `clearTimeout` call — leaving A's timer armed. If it then fired before B's real response
     arrived, it applied A's stale data and clobbered `pendingBlockId` back to `undefined`,
     silently discarding B's legitimate response entirely. Reproduced directly (a real,
     confirmed RED test, not a hypothetical) and fixed at the root: both effects now return
     their scheduled timer(s) from an unconditional cleanup function, so React cancels them on
     *every* dependency change — not only when a guard happens to re-pass. Regression test
     added (`GraphView.test.tsx`'s "a superseded dive's already-armed timer chain never applies
     its data after a newer dive interrupts it") — confirmed RED against the pre-fix code by
     temporarily reverting the fix and re-running, then confirmed GREEN after restoring it.
  2. Checked and correct: `commands/show-architecture.ts`'s `triggerMicroAnalysis` dual-gate
     (read line by line, not the comments) and `AnalysisRunner`'s independent micro generation
     counter both hold up exactly as designed, including the post-await re-check.
  3. Checked and correct: the cache-missing / stale-`blockId` / file-deleted-before-LOC-read
     degrade paths all behave as designed — structured errors or a `0`-LOC fallback, never a
     crash or a hang.
  4. **Defensible tradeoff, documented (not fixed):** `analyze-micro.ts`'s intra-block cycle
     detection is numerically correct (real whole-graph Tarjan SCC membership) but can flag a
     file/edge risky for a cycle that isn't actually fully contained in the requested block —
     if the SCC also spans a file in a different block, that file never appears in the micro
     view, so the cycle can't be fully explained from what's shown. Documented explicitly in
     `analyze-micro.ts`'s header comment and `DATA-MODEL.md`'s field notes rather than silently
     shipped or silently "fixed" by suppressing a true finding.

**Verification status (at initial ship):**
- `sh .githooks/pre-push` green after every unit above, after both live-verified bugfixes, and
  after the two-pass review's fixes: core 279/279 (28 files), extension 42/42 (6 files),
  webview 101/101 (14 files) — builds/typechecks/tests/lints all pass.
- Live-verified via Playwright against a real `vite dev` server on `?sample=1`/`?stress=1`:
  dive-in (loading indicator → cross-fade → file cards with correct LOC/dirty/risk), the ⤢
  open-in-editor button (no-op in fixture mode, confirmed non-throwing), back navigation via
  both the breadcrumb and the dedicated button, a plain single click still just selecting (not
  diving), and the `graph/micro/error` fallback path (a block with no fixture micro data).
- Not yet done at ship time: real-repo (non-fixture) verification of `analyze-micro.ts` against
  an actual multi-block real repository — closed the same day, see below.

### Real-repo verification of `analyze-micro.ts` ✅ (2026-07-21, same day as ship)

Ran the Checkpoint-A-style loop (`docs/planning/PROGRESS.md`'s Checkpoint A section) against
three real repos — `aetherinc` (1,043 files, flat Next.js), `AetherArenaV2/aether-arena` (6,553
files, real multi-language multi-block split), and BlockNet analyzing itself (984 files, nested
npm workspaces) — via a scratch script driving `analyze()` + `analyzeMicroBlock()` from core's
built `dist/index.js` for every detected block in each repo, checking each block's micro file
count against its macro `fileCount`, scanning for anomalous per-block timings, and spot-checking
flagged zero-LOC files against the real filesystem. **Found and fixed 3 real bugs the fixture
suite's 8 tests never had a shape to catch:**

1. **Nested-block file double-counting.** `filesForBlock()`'s non-root branch walked a block's
   whole subdirectory unfiltered — a block whose directory legitimately contains a MORE
   SPECIFIC nested block (this repo's own root `package.json`: `workspaces: ["core",
   "extension", "extension/webview"]`) had the nested block's files counted twice.
   `analyzeMicroBlock('extension')` returned 80 files against the authoritative `fileCount` of
   24 (exactly 24 + `extension/webview`'s 56).
2. **Large/binary file full-read performance bug.** `countLines()` unconditionally read every
   file fully as UTF-8 and split it on newlines, no size guard. A 528MB `.tar.gz` checked into
   `aetherinc`'s repo root made that block's micro request take 2-3s (vs ~150ms for a
   similarly-sized block without such a file) — full UTF-8 decode + split of the entire binary,
   every request. Fixed with a 2MB size cap (`MAX_LOC_SCAN_BYTES`, `analyze-micro.ts`): files
   larger than that `statSync`-check and skip the read, degrading to the existing `loc: 0`
   sentinel already used for a deleted/unreadable file.
3. **Cross-block symlink dedup mismatch**, found by the architectural-soundness review lane
   (below) after bug 1's fix was made, not by the initial real-repo run itself: bug 1's first
   fix filtered the scoped walk through `resolveBlock()` but still called `walkRealFiles`
   scoped to just the block's own subdirectory — a fresh, independent real-path-dedup instance
   per call (`file-walk.ts`). `analyze.ts`'s `computeBlockShape()` (the authoritative
   `fileCount`) gets correct cross-block dedup for free because it makes exactly ONE whole-tree
   walk; a per-block scoped call has no visibility into what a different block's own walk
   already claimed. A physical file reachable via a symlink in one block's directory but
   physically owned by another (a real Nx/Bazel-style tooling pattern) was listed by both
   blocks' scoped walks even though the shared-dedup `fileCount` only ever credits it once.

**Real fix for both (1) and (3), superseding the two independent point-fixes above:**
`filesForBlock()` now always does the exact same thing `computeBlockShape()` does — one
`walkRealFiles(rootDir)` call (whole repo, one shared dedup instance), filtered by
`resolveBlock(file, allBlocks) === block.id` — for every block, root or not, no more
scoped-subdirectory branch to silently diverge. Deliberate tradeoff: every micro request now
pays for a whole-tree walk instead of one scoped to the requested block. Re-measured against all
3 real repos after the fix: worst case (`AetherArenaV2/aether-arena`'s real 122-file `desktop`
block, in a 6,553-file repo) went from ~79ms (scoped, buggy) to ~187ms (whole-tree, correct) —
still well under a second, and a small fraction of a full re-analysis (~5s for the same repo).
3 new regression tests added (`core/test/analyze-micro.test.ts`, TDD: each confirmed RED against
the pre-fix code, then GREEN), 11 total in that file, 282/282 across the whole `core` suite.

**Two-pass adversarial review of these 3 fixes** (per `CLAUDE.md`'s ritual) — doc-consistency
lane found this doc itself was stale (wrong test count, this "not yet done" claim contradicting
same-day work) plus stale descriptions in `FLOWS.md`/`DIRECTORY-TREE.md` and one inaccurate
`package.json` quote in a docstring — all fixed, this section included. Architectural-soundness
lane found bug 3 above (confirmed by executing a hand-built symlink reproduction, not just
reading the diff) and confirmed, by directly running `analyze()`/`analyzeMicroBlock()` against
the real `AetherArenaV2/aether-arena/open-connector` block (5,303 files / ~11,280 edges), no
further scaling issue: 167ms including a full `findCyclicFileEdges()` Tarjan pass. Also flagged,
checked and accepted rather than fixed: `MicroFileNode.loc: 0` is now an overloaded sentinel
(empty file / deleted-unreadable / over-2MB-skip all collapse to the same value) — searched all
3 real repos for a legitimate committed source/generated file over 2MB outside an
already-excluded directory, found none, so this is a real theoretical gap not yet observed on
real data (documented in `analyze-micro.ts` and `DATA-MODEL.md`).

**Not yet done:** no real F5 extension-development-host run (same standing gap as every Task
since 6 — no VS Code GUI in this building environment); this round verified the core engine's
data correctness against real repos via a headless script, not the webview's actual rendering of
that data against real (non-fixture) input.

## Draggable/bendable edge routing ✅ (2026-07-21, same day as scoped)

`ROADMAP-V2.md`'s "Also noted in the prototype, undecided" item — manual waypoints a user can
drag onto an edge so a large/messy real-repo graph (dozens of blocks, tangled crossings) can be
manually decluttered rather than staying stuck with whatever dagre auto-layout (AD-7) produced.
Scoped, designed, built, live-verified, and doc-reconciled in one session.

**Design decisions made** (the two things `ROADMAP-V2.md`'s note explicitly left undecided):
persistence is `context.workspaceState` under a new `blocknet.edgeWaypoints` key — a second,
independent sparse-override map alongside `blocknet.positions`, following `state.ts`'s existing
pattern exactly (`getEdgeWaypoints`/`setEdgeWaypoints`, mirroring `getPositions`/`setPositions`).
Drag interaction: exactly ONE waypoint per edge (not an arbitrary polyline) — the simplest unit
that achieves "decluttering," extensible later if a real need for multiple bend points ever
surfaces. Scoped to `BlockCanvas.tsx`'s macro graph only, not `FileCanvas.tsx`'s micro-view edges
(`ROADMAP-V2.md`'s own framing names the macro graph's real-repo scale/crossing problem; the
micro view has no equivalent stated need).

**What got built:**
- `core`: untouched — this is pure webview/extension-host view state, never core schema
  (edge waypoints aren't "import truth," same category as node positions).
- `extension/webview/src/flow/edge-path.ts`: `buildEdgePath()` gained an optional `waypoint`
  param — stitches two of the same cubic-bezier segments (source→waypoint, waypoint→target)
  into one path when present, instead of a different curve family, so a bent edge stays visually
  consistent with every unbent one.
- `extension/webview/src/flow/RiskEdge.tsx`: `WaypointHandle`, a draggable div rendered via React
  Flow's `EdgeLabelRenderer`, using `useReactFlow().screenToFlowPosition` (pointer→flow-space
  conversion) and `useViewport().zoom` (a `1/zoom` counter-scale so the handle stays a constant,
  grabbable on-screen size regardless of canvas zoom). Dragging the handle back within 14
  flow-space px of its own natural rest position resets to "no override" — the discoverable way
  to un-bend an edge without a second UI affordance.
- `extension/webview/src/camera-store.ts`: `useCameraStore` extended to own `edgeWaypoints`
  alongside `positions`, sharing ONE debounced `layout/persist` send for both — a position drag
  and a waypoint drag close together in time coalesce into one write rather than racing as two
  independently-debounced ones.
- `extension/src/shared/protocol.ts`, `extension/src/state.ts`, `extension/src/panel.ts`,
  `extension/src/commands/show-architecture.ts`, `extension/webview/src/App.tsx`,
  `extension/webview/src/flow/GraphView.tsx`, `extension/webview/src/flow/BlockCanvas.tsx`:
  `edgeWaypoints` threaded end to end through `layout/restore`/`layout/persist`,
  `onLayoutPersist`'s (now two-argument) callback, and `flowEdges`'s `data`.
- Tests: `edge-path.test.ts` (waypoint stitching), `RiskEdge.test.tsx` (rewritten to mount inside
  a real, otherwise-empty `<ReactFlow>` sibling so `EdgeLabelRenderer`'s portal target exists —
  a bare `<ReactFlowProvider>` alone doesn't populate it), `camera-store.test.tsx`,
  `extension/test/state.test.ts`. `extension/webview/test/setup.ts` gained a global stub for
  `Element.prototype.setPointerCapture`/`releasePointerCapture` (jsdom has neither at all, not
  just a no-op — a real browser, including VS Code's Electron/Chromium host, fully supports it).

**Three real bugs found via live Playwright testing during the build itself** (not after —
each was found, fixed, and re-verified live before moving to the next step):

1. **The first handle implementation (an inline SVG `<circle>` inside the edge's own `<g>`) had
   zero hit-testable area at all.** React Flow's own base CSS sets
   `.react-flow__edge { pointer-events: visibleStroke }`, inherited by every descendant; a
   fill-only circle with no stroke has no hit-testable area under that mode. Fixed with an
   explicit `pointer-events: all` override — but this alone wasn't enough (see #2).
2. **Even with a hit area, the handle lost to a DIFFERENT, unrelated edge's own wide invisible
   interaction stroke at heavy zoom-out.** SVG paint order is document-order across the WHOLE
   graph, not scoped per-edge — confirmed live against the 100-edge stress fixture: a real drag
   on a risky edge's handle silently hit another edge's interaction path instead. **Both #1 and
   #2 were fixed by rebuilding the handle from scratch** using React Flow's `EdgeLabelRenderer`
   (a portal into a shared HTML layer above ALL edges' SVG, the library's own documented
   mechanism for exactly this "interactive widget on an edge" case) plus the `1/zoom`
   counter-scale — re-verified live against the same stress fixture after the rebuild.
3. **The rebuilt handle could still be buried — under an unrelated NODE card.** React Flow's own
   fixed internal layer order (`.react-flow__edges` → `.react-flow__edgelabel-renderer` →
   `.react-flow__nodes`, all at `z-index: auto`) means every node paints above every edge label
   by construction. Confirmed live: a real drag on `?sample=1`'s `web-db` edge (whose natural
   midpoint happens to sit under the `ui` block's card in that fixture's layout) silently did
   nothing — the card, not the handle, received every pointer event. Not a fixture quirk: any
   edge connecting two non-adjacent blocks whose midpoint visually passes under a third,
   unrelated block hits the identical gap in a real, compact layout. Fixed with an explicit
   `z-index: 1000` on `.react-flow__edgelabel-renderer` (safe because the container itself keeps
   React Flow's default `pointer-events: none` — only the opted-in handle divs are interactive,
   so normal node clicks elsewhere are unaffected).

**Two-pass adversarial review** (doc-consistency + architectural-soundness, run after the above
three were already fixed and live-verified) — **the architectural-soundness lane found one more
real, more subtle bug**, confirmed by hand-tracing the code (no live browser tool was available
to that reviewer): the risk-badge-avoidance display offset (`+24` in Y, so a risky edge's handle
doesn't render exactly on top of its own "!" badge) was applied only when RENDERING the handle,
never when reading the cursor back — so (a) the handle visibly didn't track the mouse during a
drag on a risky edge (a constant 24-unit gap the whole gesture), and (b) the reset-gesture's
distance check compared the raw waypoint against the UNOFFSET natural midpoint, meaning
"drag it back to where it visually sits, let go" for a risky edge released ~24 units away from
what the check expected (itself bigger than the 14px snap threshold) — **the reset could never
fire for any risky edge, and could even drift the stored waypoint further away on repeated
attempts.** Fixed by routing both the render and the reset comparison through one shared
`handleRestPosition()` function so they can't independently drift again; a dedicated regression
test (`RiskEdge.test.tsx`) confirmed RED against the pre-fix comparison logic, then GREEN after.
Re-verified live: the fix works for both the coincidence-free case and (after also fixing #3
above, since this specific edge's midpoint happened to sit under another node) `?sample=1`'s
real `web-db` edge.

Doc-consistency lane found and fixed: this doc's own "not yet built" framing for this exact
feature (self-contradictory the moment it shipped), a duplicate local `Position` type in
RiskEdge.tsx (now imports the canonical one via `layout.ts`'s re-export, matching every other
webview file), a missing docstring on `setEdgeWaypoints` (added, mirroring `setPositions`'s),
and "v1 of this feature" phrasing that overloaded this project's precise, reserved meaning of
"v1" (reworded). Checked and accepted, not fixed: `layout/persist`'s two fields are written to
workspaceState via two separate (not atomically paired) `memento.update()` calls — real, but
masked in practice by VS Code's own storage-service write coalescing, and this is view state (a
lost drag needs redoing) rather than import truth (STATE-OWNERSHIP.md's atomicity guarantee
exists for the latter, not this).

**Known, accepted limitation, not fixed at this point in the project:** two edges whose natural
midpoints (or current waypoints) land on the exact same point — confirmed reachable live (this
project's own `?sample=1` fixture has two genuinely unrelated edges whose dagre-computed
midpoints coincide exactly, traced by hand to confirm it's numeric coincidence, not a structural
property of any particular edge shape like an import cycle) — have their handles overlap
pixel-for-pixel; only the later-portaled one is reachable until the user drags it away, exposing
the other. No parallel/anti-parallel edge-offset system exists to prevent this (a real, separate
feature in its own right, the kind most graph-visualization libraries solve by curving co-located
edges apart) — documented in `RiskEdge.tsx`, not built here.
**Superseded:** this was built in the very next round of work, same day — see "Multi-point
waypoint redesign + file-level drag parity" below (`graph-derive.ts`'s `siblingOffsets()`).

**Verification status:** `sh .githooks/pre-push` green after every fix above: core 282/282
(28 files, unchanged — no core involvement), extension 47/47 (6 files), webview 118/118
(14 files). Live-verified via Playwright against a real `vite dev` server on both `?sample=1`
and the 100-edge `?stress=1` fixture: drag bends the edge without the pane also panning (the
same child-captures-before-pane-sees-it guarantee React Flow's own `nopan` class provides,
confirmed directly from `@xyflow/system`'s installed source, not assumed from a comment);
drag-back-to-natural-position resets correctly for both plain and risky edges; a plain click
(no movement) on the handle still lets edge-selection's native `click` event bubble normally;
normal node-dragging and pane-pan/zoom are unaffected. **Not yet done:** no real F5
extension-development-host run (same standing gap as every Task since 6).

## Multi-point waypoint redesign + file-level drag parity ✅ (2026-07-21, same day)

The single-waypoint edge design shipped above turned out to leave two gaps the moment it was
used for real: (1) it couldn't decongest an edge that needed more than one bend, and (2) the
"known, accepted limitation" it shipped with — coincident reciprocal-edge handles — was reachable
on this project's own sample fixture, not a hypothetical. Same session, redesigned to a full
"grab the line anywhere, drop a bend point" multi-point gesture, and file-level (micro view)
drag parity was built alongside it so `FileCanvas.tsx` gets the identical drag/persist mechanics
`BlockCanvas.tsx` already had. `core` stayed untouched throughout — this is entirely
webview/extension-host view state, same category as the original single-waypoint design.

**What got built:**
- `extension/webview/src/flow/edge-path.ts`: `buildEdgePath()`'s `waypoint?: Position` param
  widened to `waypoints?: Position[]` — stitches N+1 cubic segments (source→wp0, wp0→wp1, …,
  wpN-1→target) into one path instead of exactly two, generalizing the original design without
  changing behavior for 0 or 1 waypoints. New `nearestPointOnEdgePath()` samples the CURRENT
  (possibly already-bent) path at 24 points per segment to find where a click landed and which
  `insertIndex` a new point splices into — the direct replacement for the original design's
  single, separately-rendered handle dot. `controlPointOffset()` (line 29) is now the one shared
  function behind both `segment()` (what actually renders) and `segmentControlPoints()` (what
  `nearestPointOnEdgePath` samples for hit-testing) — they used to be two independent copies of
  the same formula.
- `extension/webview/src/flow/RiskEdge.tsx`: rewritten around `liveWaypoints` (a ref, not
  `data.waypoints` read directly) plus `emit()` (line 133) as the single mutation path — every
  gesture reads/writes through these so a fast drag or a debounced `onWaypointsChange` caller
  never computes an insert/removal against a stale array. `basePoints()` (line 128) is what
  "realizes" the implicit sibling-offset point (below) into a real waypoint on first touch.
  `WaypointHandle` renders one `<div>` per CONFIRMED waypoint only (no permanent ghost handle at
  rest, unlike the original design) via `EdgeLabelRenderer`, unchanged from the original design's
  own fix for edge-vs-edge and edge-vs-node z-order.
- `extension/webview/src/flow/graph-derive.ts`: new `siblingOffsets()` (line 62) — a per-edge Y
  bias keyed by the UNORDERED `{source,target}` pair, so a reciprocal A→B/B→A pair (this tool's
  most common risk pattern) never renders as visually coincident curves. Fixes the previous
  section's "known, accepted limitation" outright.
- `extension/webview/src/flow/FileCanvas.tsx`: gained `initialPositions`/`initialEdgeWaypoints`/
  `onPositionChange`/`onWaypointsChange` props — the same drag/persist contract `BlockCanvas.tsx`
  already had, now present at file granularity too.
- `extension/webview/src/camera-store.ts`'s `useCameraStore` is called a SECOND, independent time
  from `GraphView.tsx` for file-level state, supplying a `layout/file-persist` callback instead of
  the macro `layout/persist` one — reusing the existing hook rather than writing a parallel one.
- `extension/src/state.ts`: new `blocknet.filePositions`/`blocknet.fileEdgeWaypoints` keys —
  `getFilePositions`/`setFilePositions`/`getFileEdgeWaypoints`/`setFileEdgeWaypoints` — mirroring
  `getPositions`/`getEdgeWaypoints`'s existing pattern exactly, stored independently so a
  micro-view drag can never clobber a macro one.
- `extension/src/shared/protocol.ts`: `positions`/`edgeWaypoints` widened to
  `Record<string, Position[]>` for the multi-point shape; new `layout/file-persist`
  (`filePositions`, `fileEdgeWaypoints`) `WebviewMessage` and matching `layout/restore` fields.
  `extension/src/panel.ts` and `extension/src/commands/show-architecture.ts` thread the new
  message/keys end to end, same posture as the original `layout/persist` wiring.

**Seven real, live-reproduced bugs found and fixed, most with a regression test:**
1. **RF error #015 flicker on file-card drag** (`FileCanvas.tsx`, line 77-102): `baseFlowNodes`
   read `initialPositions` reactively; since `GraphView.tsx` feeds a fresh object on every drag
   frame, that fought React Flow's own internal drag-tracking state, confirmed live as 29 repeated
   #015 warnings during a real 40-step drag. Fixed via a `useState` lazy-init (`seedPositions`,
   captured once at mount, matching `FileCanvas`'s full-remount-per-dive lifecycle). **No jsdom
   regression test exists for this one** — the component's own comment (line 118) explains why:
   its reconciliation effect already preserves position on every re-render regardless of what
   `baseFlowNodes` recomputes, so a `rerender()`-based test would pass identically whether or not
   the bug were present; only live Playwright against a real drag proves it.
2. **Stale-closure crash/wrong-removal in waypoint gestures** — fixed via the `liveWaypoints` ref
   + `emit()` pattern in `RiskEdge.tsx` (line 117-139); covered by that file's whole "multi-point
   waypoint dragging" describe block (`RiskEdge.test.tsx`).
3. **Risk badge intercepting pointerdown meant for the drag path** — the SVG `<text>` badge's
   default (non-none) `pointer-events` ate the pointerdown at exactly an unbent edge's natural
   midpoint, the single most likely place to grab first. Fixed with `pointer-events: none` on
   `.bn-edge-badge` (`RiskEdge.css` line 79-81).
4. **Near-miss on an existing waypoint spawning a duplicate instead of moving it** — fixed via
   `SNAP_TO_EXISTING_PX = 20` (`RiskEdge.tsx` line 65), checked in screen px so the target stays a
   constant size regardless of zoom. Regression test: `RiskEdge.test.tsx`'s "inserts at index 0/1
   for a drag near the Nth segment when a waypoint already exists."
5. **Backwards-edge control-point blowout (300+px off-canvas)** — the uncapped
   `Math.abs(dx) * 0.5` grew without bound for a right-to-left edge; a real 618px-apart backwards
   edge pushed control points to x=924/x=-312. Fixed with `MAX_CONTROL_POINT_OFFSET = 220`
   (`edge-path.ts` line 16). Regression test: `edge-path.test.ts`'s "caps the control-point offset
   for a BACKWARDS edge."
6. **Coincident reciprocal-edge overlap** (two edges between the same node pair rendering as
   literally the same curve, so a drag on one could silently grab the other) — fixed via
   `siblingOffsets()`/`implicitPoint`/`basePoints()` (`graph-derive.ts`, `RiskEdge.tsx`).
   Regression tests: `graph-derive.test.ts`'s whole `siblingOffsets` describe block (7 cases,
   including "groups a RECIPROCAL pair… together — direction does not create separate groups";
   `graph-derive.test.ts` is 15 cases total across all three describe blocks in the file).
7. **Selecting a risky edge turned it gray** — a CSS specificity tie (both the unselected rule and
   React Flow's own `.selected` base rule sat at the same `(0,3,0)` specificity, so which one
   painted depended on stylesheet import order). Fixed by redeclaring `stroke` explicitly in both
   `.bn-edge[data-selected]` and `.bn-edge[data-risk][data-selected]` (`RiskEdge.css` line 29-63),
   the higher-specificity risk-selected rule winning outright regardless of import order.

**Third architectural-soundness review pass** (per `CLAUDE.md`'s ritual, run after the seven bugs
above were already fixed and live-verified) — found and triaged two more issues, confirmed one
already-fixed, and confirmed one investigated finding as a non-issue:
1. **Real bug, fixed:** `graph-derive.ts`'s `siblingOffsets()` originally assigned reciprocal-edge
   offsets by raw array (Map-iteration) order — not a stable input, since `core`'s incremental
   re-analysis (`core/src/analyze.ts`) filters a modified file's edges out of the cache and
   appends freshly-extracted ones at the end, even for an import-identical, comment-only edit
   (the content hash still changes). A routine save could silently swap which sibling of a
   reciprocal pair gets -22px vs +22px. Fixed by sorting group members by edge `id` (line 76)
   before assigning offsets. Regression test: `graph-derive.test.ts`'s "assigns the SAME offsets
   regardless of array order — not derived from array position."
2. **Already fixed before this review ran:** `edge-path.ts`'s `controlPointOffset` formula had
   been duplicated between `segment()` and `segmentControlPoints()`, with the
   `MAX_CONTROL_POINT_OFFSET` cap applied to only one copy — confirmed both call sites now share
   the one `controlPointOffset()` function (line 29), with `edge-path.test.ts`'s "samples the SAME
   curve buildEdgePath actually renders for a long backwards edge past the control-point cap"
   locking the two together.
3. **Investigated, found to be a non-issue:** whether dragging one waypoint onto an adjacent one
   needed an explicit anti-collapse guard. It doesn't: `distanceToSegment(curr, prev, next)` in
   `commitAndCheckRemoval` (`RiskEdge.tsx` line 141-158) is mathematically bounded above by the
   distance to either endpoint, and `prev`/`next` ARE the segment's own endpoints — so a waypoint
   dragged onto or near a neighbor was already caught by the existing straight-line-collapse
   check. No code change; a regression test was added to lock in the behavior
   (`RiskEdge.test.tsx`'s "collapses (removes) a waypoint dragged directly onto its own adjacent
   neighbor, not just onto the straight line").
4. **Comment gap closed:** why `initialEdgeWaypoints` is read reactively in `FileCanvas.tsx` while
   `initialPositions` is a frozen `useState` (bug #1 above) went unexplained. Closed with a
   comment at `FileCanvas.tsx` line 143-153: waypoint dragging has no React-Flow-internal drag
   state to fight (RiskEdge.tsx's gesture is manual refs + pointer capture, entirely outside RF's
   controlled-node machinery), and every mutation to the waypoints map originates from this same
   component's own `emit()` call, so a later prop-driven resync only ever reaffirms a value the
   gesture already wrote.

**Docs:** `STATE-OWNERSHIP.md` and `DIRECTORY-TREE.md` were reconciled against this round's
changes in the same turn (new state keys, new files); `FLOWS.md` gained a corrected
`moveWaypoints` signature and a new flow section for `layout/file-persist` — not otherwise
detailed here. `ROADMAP-V2.md` also gained a new v2.0.1 entry (recursive directory-tree micro
view + cross-layer connection indicators — Krish's request, scoped as planning only, not yet
built) inserted ahead of v2.1, and its stale "one waypoint per edge" note was corrected.

**Two-pass adversarial review of this round** (per `CLAUDE.md`'s ritual — Lane A doc-consistency,
Lane B architectural-soundness, run independently in parallel): Lane A found one real issue —
this doc's own test-count misattribution above (now fixed) — and confirmed every other doc/code
claim in this round by reading and running, not assuming. Lane B found no correctness bugs; its
one actionable finding was a coverage gap: `siblingOffsets()`'s array-order independence was only
tested at group size 2, while `extension/webview/src/fixtures/stress-graph.ts`'s own stress
fixture generates real reciprocal groups up to size 7 between a single block pair. Lane B
independently verified the algorithm is correct at those sizes by hand-computation before
flagging it as a test gap, not a bug; closed with a new test in `graph-derive.test.ts` (a 5-edge
group, shuffled and reversed, asserting identical output). Lane B also confirmed via
`core/src/edges/block-aggregate.ts:44`/`core/src/analyze-micro.ts:128` that edge ids are pure
functions of `(source, target)`, always recomputed fresh from scratch on every `analyze()` call
— never carried over from cache — so the sort-by-id fix cannot be defeated by an id changing
identity for the same logical edge across a re-analysis.

**Verification status:** `sh .githooks/pre-push` green after every fix above, including the
review round: core 282/282 (28 files, unchanged — no core involvement), extension 57/57 (6
files), webview 159/159 (14 files, +1 from the group-size-5 order-independence test). Representative
per-file test counts at this point: `RiskEdge.test.tsx` 22 cases, `edge-path.test.ts`
22, `graph-derive.test.ts` 16, `FileCanvas.test.tsx` 13, `camera-store.test.tsx` 14,
`state.test.ts` 19. **Not yet done:** no real F5 extension-development-host run (same standing gap
as every prior round); no jsdom regression test for bug #1 (RF #015) — see that bug's own note
above for why one wasn't attempted.

## Known gaps / next up (not yet built)

*(Nothing currently tracked here — the previous entry, multi-point waypoint redesign + file-level
drag parity, shipped above. Continue `ROADMAP-V2.md`'s own promotion order: v2.1 Connection
Inspector next.)*
