import { useEffect, useRef, useState } from 'react';
import type { Edge as CoreEdge, MicroFileEdge } from '@blocknet/core';
import type { Position, WebviewBlockNode, WebviewMicroFileNode } from '../../../src/shared/protocol.js';
import { BlockCanvas } from './BlockCanvas.js';
import { FileCanvas } from './FileCanvas.js';
import { useCameraStore } from '../camera-store.js';
import { postToHost } from '../host-bridge.js';
import './GraphView.css';

// ~0.45–0.5s per the design-handoff prototype (docs/planning/ROADMAP-V2.md's v2.0 spec) —
// GraphView.css's transition duration and this JS-side unmount delay must stay in sync (the
// delay exists purely so FileCanvas's ReactFlow instance survives long enough to actually
// render its own fade-out, matching camera-store.ts's own precedent of a JS timer paired with
// a CSS transition length).
const TRANSITION_MS = 500;

export type MicroPayload = { blockId: string; files: WebviewMicroFileNode[]; edges: MicroFileEdge[] };
export type MicroErrorPayload = { blockId: string; message: string };

export type GraphViewProps = {
  macroNodes: WebviewBlockNode[];
  macroEdges: CoreEdge[];
  initialPositions?: Record<string, Position>;
  /** ROADMAP-V2.md's draggable/bendable edge routing — same sparse-override contract as
   * initialPositions. Defaults to empty for callers (tests, the stress fixture) that don't
   * care about persistence. */
  initialEdgeWaypoints?: Record<string, Position[]>;
  /** File-level drag parity (docs/planning/ROADMAP-V2.md) — same sparse-override contract as
   * initialPositions/initialEdgeWaypoints, but spanning every file/micro-edge ever dragged
   * across every block, not just the one currently being viewed (see this file's own
   * file-camera-store comment for why GraphView, not FileCanvas, is where this has to live).
   * Defaults to empty for callers (tests, the dev/QA fixture bypass) that don't care about
   * persistence. */
  initialFilePositions?: Record<string, Position>;
  initialFileEdgeWaypoints?: Record<string, Position[]>;
  /** Latest successful graph/micro response from the host, if any — undefined until the first
   * dive-in ever completes. Compared against local `pendingBlockId`/`activeBlockId` state
   * below, never trusted positionally, since a stale response for a superseded request can
   * still arrive (the host-side dual-generation gate already discards most of these —
   * commands/show-architecture.ts's triggerMicroAnalysis — this is the client-side second
   * layer of the same belt-and-suspenders pattern Task 9 established for graph/macro). */
  micro?: MicroPayload | undefined;
  microError?: MicroErrorPayload | undefined;
  onRequestMicro: (blockId: string) => void;
};

/** Owns the macro↔micro cross-fade (docs/planning/ROADMAP-V2.md's v2.0 micro view). Both
 * ReactFlow instances (BlockCanvas, FileCanvas) are real, independent components — this never
 * swaps one graph's data into the other's canvas, only toggles which layer is visible/
 * interactive via CSS opacity+transform, matching the design-handoff prototype's own two-
 * permanently-adjacent-layers mechanism (not a single canvas re-themed).
 *
 * Deliberately does NOT optimistically cross-fade the instant a double-click fires, unlike the
 * prototype (which had no real async fetch — its MICRO data was static/local). A double-click
 * here triggers a real host round-trip (fork + cache read, commands/show-architecture.ts); the
 * macro view stays fully visible and interactive with a small loading indicator while that's in
 * flight, and the cross-fade itself only starts once real file data (or an error) has arrived —
 * "never fake it" (CLAUDE.md), applied to a transition instead of a data value. */
export function GraphView({
  macroNodes,
  macroEdges,
  initialPositions,
  initialEdgeWaypoints,
  initialFilePositions,
  initialFileEdgeWaypoints,
  micro,
  microError,
  onRequestMicro,
}: GraphViewProps) {
  const [phase, setPhase] = useState<'macro' | 'diving' | 'micro'>('macro');
  const [pendingBlockId, setPendingBlockId] = useState<string>();
  const [activeBlock, setActiveBlock] = useState<{ id: string; name: string }>();
  const [microMounted, setMicroMounted] = useState(false);
  const [banner, setBanner] = useState<string>();
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A SECOND, independent useCameraStore instance from BlockCanvas.tsx's own internal one —
  // owned here, at GraphView level, specifically because FileCanvas remounts fresh on every
  // dive (even a same-session re-dive into a block already visited once). BlockCanvas never
  // remounts, so its own locally-owned instance is fine; FileCanvas's own state would reset to
  // whatever `initialFilePositions` prop it received at ITS mount time on every dive, silently
  // reverting any drag made during a prior dive this session. Living here instead — a
  // component that mounts once for the panel's whole lifetime — means a drag updates this
  // hook's own React state immediately (not just eventually-consistent workspaceState), so the
  // very next dive (into any block, including the same one) reads the up-to-date value.
  // Persists via `layout/file-persist`, a distinct message from BlockCanvas's `layout/persist`
  // — see protocol.ts's own comment for why these stay two independent hooks/messages rather
  // than one combined shape.
  const {
    positions: filePositions,
    movePosition: moveFilePosition,
    edgeWaypoints: fileEdgeWaypoints,
    moveWaypoints: moveFileWaypoints,
  } = useCameraStore(initialFilePositions ?? {}, initialFileEdgeWaypoints ?? {}, (positions, edgeWaypoints) =>
    postToHost({ type: 'layout/file-persist', filePositions: positions, fileEdgeWaypoints: edgeWaypoints }),
  );

  // Both effects below return their scheduled timer(s) from an unconditional cleanup function
  // — not the earlier version's approach of clearing a shared ref only as a side effect of the
  // SAME guard passing again on a later run. That was a real, reproduced race (two-pass
  // review's architectural-soundness lane): dive into block A, let A's graph/micro arrive and
  // schedule its two-tick mount-then-flip timer chain, then dive into block B before A's
  // timers fire — the effect re-runs, but its guard now checks against B's pendingBlockId and
  // fails, so control returns BEFORE the old timer is ever cancelled. A's stale timer still
  // fires, closing over A's own data, and unconditionally applies it — showing block A's files
  // under block B's identity, or worse (the microError effect had the same defect) silently
  // discarding B's real response by clobbering pendingBlockId back to undefined.
  //
  // Returning `() => { clearTimeout(...) }` from inside the effect fixes this at the root:
  // React calls a render's cleanup before running the NEXT render's effect body, on every
  // dependency change, unconditionally — not only when some guard happens to pass again. A
  // superseded dive's timers are therefore always cancelled before the new dive's effect run
  // even starts, regardless of which stage (outer/inner tick) was in flight.
  useEffect(() => {
    if (phase !== 'diving' || !micro || micro.blockId !== pendingBlockId) return;
    const block = macroNodes.find((n) => n.id === micro.blockId);
    clearTimeout(unmountTimer.current);
    // Every state update below runs inside a timer callback, not directly in this effect's own
    // synchronous body (react-hooks/set-state-in-effect) — deliberately, not just to satisfy
    // the linter: it's also what makes the two-step transition real. The first tick mounts
    // FileCanvas at its CSS "hidden" style (GraphView.css); only the SECOND, nested tick flips
    // `phase` to 'micro' and starts the actual cross-fade — collapsing both into one tick would
    // let the browser coalesce the hidden and visible styles into a single paint, skipping the
    // transition entirely. setTimeout over requestAnimationFrame specifically so this stays
    // deterministic under vitest's fake timers (GraphView.test.tsx) as well as real browsers —
    // the same practical tradeoff camera-store.ts's own debounce timers already make.
    let innerTimer: ReturnType<typeof setTimeout> | undefined;
    const outerTimer = setTimeout(() => {
      setActiveBlock({ id: micro.blockId, name: block?.name ?? micro.blockId });
      setMicroMounted(true);
      setPendingBlockId(undefined);
      innerTimer = setTimeout(() => setPhase('micro'), 0);
    }, 0);
    return () => {
      clearTimeout(outerTimer);
      clearTimeout(innerTimer);
    };
  }, [micro, phase, pendingBlockId, macroNodes]);

  useEffect(() => {
    if (phase !== 'diving' || !microError || microError.blockId !== pendingBlockId) return;
    const timer = setTimeout(() => {
      setPendingBlockId(undefined);
      setPhase('macro');
      setBanner(microError.message);
    }, 0);
    return () => clearTimeout(timer);
  }, [microError, phase, pendingBlockId]);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(undefined), 4000);
    return () => clearTimeout(timer);
  }, [banner]);

  // Unmount-on-transition-end cleanup for handleBack()'s own timer — scheduled outside any
  // effect (inside a plain click handler), so it needs its own dedicated unmount guard, unlike
  // the two effects above which now clean up after themselves automatically.
  useEffect(() => () => clearTimeout(unmountTimer.current), []);

  function handleDive(blockId: string) {
    setPendingBlockId(blockId);
    setPhase('diving');
    onRequestMicro(blockId);
  }

  function handleBack() {
    setPhase('macro');
    clearTimeout(unmountTimer.current);
    unmountTimer.current = setTimeout(() => {
      setMicroMounted(false);
      setActiveBlock(undefined);
    }, TRANSITION_MS);
  }

  const showingMicro = phase === 'micro';
  const microFiles = activeBlock && micro?.blockId === activeBlock.id ? micro.files : [];
  const microEdges = activeBlock && micro?.blockId === activeBlock.id ? micro.edges : [];

  return (
    <div className="bn-graph-view">
      <div className="bn-macro-layer" data-hidden={showingMicro || undefined}>
        <BlockCanvas
          nodes={macroNodes}
          edges={macroEdges}
          initialPositions={initialPositions}
          initialEdgeWaypoints={initialEdgeWaypoints}
          onBlockDoubleClick={handleDive}
        />
      </div>
      {microMounted && activeBlock && (
        <div className="bn-micro-layer" data-visible={showingMicro || undefined}>
          <FileCanvas
            key={activeBlock.id}
            blockId={activeBlock.id}
            blockName={activeBlock.name}
            files={microFiles}
            edges={microEdges}
            onBack={handleBack}
            initialPositions={filePositions}
            initialEdgeWaypoints={fileEdgeWaypoints}
            onPositionChange={moveFilePosition}
            onWaypointsChange={moveFileWaypoints}
          />
        </div>
      )}
      {phase === 'diving' && (
        <div className="bn-micro-loading" role="status">
          Loading files…
        </div>
      )}
      {banner && (
        <div className="bn-micro-banner" role="alert">
          {banner}
        </div>
      )}
    </div>
  );
}
