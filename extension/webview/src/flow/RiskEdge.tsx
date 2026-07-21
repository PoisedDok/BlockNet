import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EdgeProps, Edge } from '@xyflow/react';
import { BaseEdge, EdgeLabelRenderer, useReactFlow, useViewport } from '@xyflow/react';
import { buildEdgePath, distanceToSegment, nearestPointOnEdgePath } from './edge-path.js';
import type { Position } from './layout.js';
import './RiskEdge.css';

export type RiskEdgeData = {
  isRisk: boolean;
  dimmed: boolean;
  /** ROADMAP-V2.md's multi-point draggable/bendable edge routing. Absent/empty = the edge
   * renders its plain geometric curve. Ordered source→target — see edge-path.ts's own
   * buildEdgePath/nearestPointOnEdgePath for why order is load-bearing (it's what makes an
   * insertIndex directly usable as an array splice index). */
  waypoints?: Position[];
  /** Present only when this edge is draggable (BlockCanvas.tsx and FileCanvas.tsx both supply
   * this — every macro AND micro edge gets the identical interaction, no macro-only carve-out
   * unlike the original single-waypoint design). Always receives the FULL replacement array,
   * matching this codebase's established sparse-override-map "replace, not merge" convention
   * elsewhere (state.ts). */
  onWaypointsChange?: (waypoints: Position[]) => void;
  /** graph-derive.ts's `siblingOffsets()` — nonzero only when another edge exists between the
   * SAME two nodes (either direction, e.g. a reciprocal A→B/B→A import-cycle pair). Purely a
   * RENDERING bias applied when `waypoints` is empty, never persisted on its own — see this
   * component's own `displayWaypoints`/`basePoints` for how it becomes a REAL waypoint only
   * once a user actually interacts with it. Without this, two edges between the same nodes
   * render literally coincident curves, which isn't just a cosmetic overlap: a "backwards"
   * edge's curve stays close to the same y as the "forward" one across its ENTIRE span
   * (edge-path.ts's horizontal-only S-curve), so a drag aimed at one edge could silently grab
   * and bend the OTHER one instead — confirmed live against a real reciprocal cycle. */
  siblingOffset?: number;
};

export type RiskEdgeType = Edge<RiskEdgeData, 'risk'>;

// A waypoint dragged back within this many flow-space px of the straight line between its two
// neighbors (source/prior-waypoint and next-waypoint/target) is removed entirely — the multi-
// point generalization of the original design's "drag back near the natural midpoint resets"
// gesture, expressed as "drag back onto the straight line and it disappears," which reads the
// same way for a bend anywhere along the edge, not just a single midpoint.
const REMOVE_DISTANCE = 14;

// SCREEN pixels (not flow-space units), deliberately: the amount of actual pointer movement
// required before a press-and-hold on the edge's own line commits to inserting a new waypoint,
// rather than being treated as a plain click (which must still reach React Flow's own edge
// click/selection handling normally — see onPathPointerDown's own comment). A flow-space
// threshold would scale by 1/zoom for the same physical mouse movement, making this feel
// twitchy zoomed out and sluggish zoomed in; comparing raw clientX/clientY keeps the "did the
// user actually mean to drag" feel constant at any zoom level.
const INSERT_MOVE_THRESHOLD_PX = 4;

// SCREEN pixels — a near-miss on an EXISTING waypoint's own small hit target (its rendered
// size is 14px, RiskEdge.css) must still grab that point, not silently insert a brand new one
// a few pixels away. Real, live-caught bug: without this, pressing down slightly outside a
// waypoint's own dot — completely plausible on a real trackpad/mouse, not a contrived case —
// created a SECOND point immediately next to the first instead of moving it. Repeated over a
// few attempts on the same already-bent edge (exactly what happens when someone tries the
// feature more than once on the same edge, which risky edges naturally attract more of, being
// the more interesting ones to test) compounds into a self-crossing, visibly tangled curve —
// not a difference between risky and plain edges, which share this exact code path with zero
// risk-conditional branching in any of it; only CSS color and the selection hit-width
// (interactionWidth below) differ by design. Set generously larger than the visual dot itself
// so "aiming near it" reliably counts as "grabbing it."
const SNAP_TO_EXISTING_PX = 20;

// A stable, shared, never-mutated empty-array reference for the "no waypoints" case — used
// instead of a fresh `[]` literal on every render so the `liveWaypoints` sync effect below
// (dependent on `waypoints`) doesn't fire on every single render of an unbent edge, only when
// the actual waypoints identity changes.
const EMPTY_WAYPOINTS: Position[] = [];

export function RiskEdge({ id, sourceX, sourceY, targetX, targetY, data, selected, markerEnd }: EdgeProps<RiskEdgeType>) {
  const isRisk = data?.isRisk ?? false;
  const dimmed = data?.dimmed ?? false;
  const waypoints = data?.waypoints ?? EMPTY_WAYPOINTS;
  const onWaypointsChange = data?.onWaypointsChange;
  const siblingOffset = data?.siblingOffset;
  const { screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();

  // The implicit sibling-separation bend — see RiskEdgeData.siblingOffset's own comment. Only
  // relevant when there's no REAL waypoint yet; the moment one exists, the user's own bend(s)
  // fully replace it (no stacking the two). Memoized (not a plain conditional expression) so
  // its object identity stays stable across renders where none of its own inputs changed —
  // `basePoints`'s own useCallback depends on it, and a fresh object every render would
  // recreate that callback every render too, for no reason.
  const implicitPoint: Position | undefined = useMemo(
    () => (waypoints.length === 0 && siblingOffset ? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 + siblingOffset } : undefined),
    [waypoints.length, siblingOffset, sourceX, sourceY, targetX, targetY],
  );
  const displayWaypoints = waypoints.length > 0 ? waypoints : implicitPoint ? [implicitPoint] : EMPTY_WAYPOINTS;

  const { d, mx, my } = buildEdgePath(sourceX, sourceY, targetX, targetY, displayWaypoints);

  // Gesture-tracking refs, not React state: every pointermove during a live gesture calls
  // onWaypointsChange directly — the actual source of truth this component re-renders from —
  // so these only need to remember "which index (if any) this gesture is currently moving"
  // between discrete pointer events, never something a render needs to react to on its own
  // (the same posture the original single-waypoint design's own `dragging` ref documented).
  const draggingIndex = useRef<number | null>(null);
  const pendingInsert = useRef<{ insertIndex: number; downClientX: number; downClientY: number } | null>(null);

  // The single source of truth for "what is the waypoints array RIGHT NOW" during an active
  // gesture — deliberately NOT the `waypoints` value read from `data` above. Nothing
  // guarantees a re-render (and therefore a fresh `data.waypoints` prop) happens between one
  // pointermove and the next, or between the LAST pointermove and pointerup, particularly for
  // a fast real gesture or a caller whose onWaypointsChange debounces/batches its own state
  // update — a real, reproduced bug found by this file's own test suite while building this:
  // computing an insert or a removal from the stale `waypoints` closure produced either a
  // wrongly-applied removal (comparing against a position from BEFORE the drag moved it) or,
  // worse, a crash (checking removal for a just-inserted index that doesn't exist yet in the
  // stale array). Kept in sync with the prop on every render via the effect below, AND written
  // to directly and immediately every time this component itself calls onWaypointsChange — so
  // it's always accurate synchronously within a single gesture regardless of whether React
  // ever gets a chance to re-render in between.
  const liveWaypoints = useRef(waypoints);
  useEffect(() => {
    liveWaypoints.current = waypoints;
  }, [waypoints]);

  // The implicit sibling-offset point (see RiskEdgeData.siblingOffset) is purely a rendering
  // illusion until a gesture actually touches it — every mutation site below reads its
  // "current, about-to-be-mutated" array through this, not `liveWaypoints.current` directly,
  // so the FIRST real move on an offset-but-untouched edge correctly "realizes" that implicit
  // point into a real one at its own current displayed position, rather than mutating an empty
  // array and losing the separation the user was looking at when they grabbed it.
  const basePoints = useCallback((): Position[] => {
    if (liveWaypoints.current.length > 0) return liveWaypoints.current;
    return implicitPoint ? [implicitPoint] : [];
  }, [implicitPoint]);

  const emit = useCallback(
    (next: Position[]) => {
      liveWaypoints.current = next;
      onWaypointsChange?.(next);
    },
    [onWaypointsChange],
  );

  const commitAndCheckRemoval = useCallback(
    (index: number) => {
      const current = liveWaypoints.current;
      if (index >= current.length) {
        // Never actually realized into a real waypoint (e.g. a plain click-no-move on the
        // implicit sibling-offset handle) — nothing to commit or remove.
        return;
      }
      const points: Position[] = [{ x: sourceX, y: sourceY }, ...current, { x: targetX, y: targetY }];
      const prev = points[index]!;
      const curr = points[index + 1]!;
      const next = points[index + 2]!;
      if (distanceToSegment(curr, prev, next) < REMOVE_DISTANCE) {
        emit(current.filter((_, i) => i !== index));
      }
    },
    [emit, sourceX, sourceY, targetX, targetY],
  );

  // Dragging an EXISTING waypoint's own handle directly.
  const onDotPointerDown = useCallback(
    (index: number) => (evt: ReactPointerEvent<HTMLDivElement>) => {
      if (!onWaypointsChange) return;
      // `nopan` (WaypointHandle's own className) is React Flow's documented mechanism for an
      // interactive EdgeLabelRenderer element that must not also start a pane pan-on-drag
      // gesture; stopPropagation here is a harmless, redundant second guard (matches the
      // original design's own established pattern).
      evt.stopPropagation();
      evt.currentTarget.setPointerCapture(evt.pointerId);
      draggingIndex.current = index;
    },
    [onWaypointsChange],
  );

  const onDotPointerMove = useCallback(
    (evt: ReactPointerEvent<HTMLDivElement>) => {
      if (draggingIndex.current === null || !onWaypointsChange) return;
      const position = screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
      const next = basePoints().slice();
      next[draggingIndex.current] = position;
      emit(next);
    },
    [basePoints, emit, onWaypointsChange, screenToFlowPosition],
  );

  const onDotPointerUp = useCallback(
    (evt: ReactPointerEvent<HTMLDivElement>) => {
      if (draggingIndex.current === null) return;
      const index = draggingIndex.current;
      draggingIndex.current = null;
      evt.currentTarget.releasePointerCapture(evt.pointerId);
      commitAndCheckRemoval(index);
    },
    [commitAndCheckRemoval],
  );

  // Grabbing the edge's own LINE somewhere with no existing handle — creates a new waypoint at
  // the pressed point, once real movement confirms this is a genuine drag rather than a plain
  // click. A plain click must still reach React Flow's own native 'click' event for edge
  // selection (BlockCanvas.tsx/FileCanvas.tsx's onEdgeClick) — stopPropagation here (like the
  // per-dot handler above) only stops the SYNTHETIC pointerdown from also starting a pane pan;
  // it does not, and must not, prevent the separate native 'click' event that fires on
  // pointerup from bubbling normally, matching the original single-waypoint design's own
  // already-proven "plain click still selects" behavior (RiskEdge.test.tsx).
  const onPathPointerDown = useCallback(
    (evt: ReactPointerEvent<SVGPathElement>) => {
      if (!onWaypointsChange) return;
      evt.stopPropagation();
      evt.currentTarget.setPointerCapture(evt.pointerId);
      const cursor = screenToFlowPosition({ x: evt.clientX, y: evt.clientY });

      // A near-miss on an EXISTING waypoint's own dot must grab that point, not insert a new
      // one beside it — see SNAP_TO_EXISTING_PX's own comment for the real, live-caught bug
      // this closes. Checked in SCREEN space (not flow-space) for the same zoom-independence
      // reason INSERT_MOVE_THRESHOLD_PX already is: a fixed flow-space radius would shrink to
      // an unusably tiny target zoomed out and balloon to an overly sticky one zoomed in.
      // basePoints() (not liveWaypoints.current directly) so a click on the implicit
      // sibling-offset point is found here too, not just on its rendered handle div.
      const current = basePoints();
      let nearestExistingIndex = -1;
      let nearestExistingDistancePx = Infinity;
      for (let i = 0; i < current.length; i++) {
        const wp = current[i]!;
        const distancePx = Math.hypot(wp.x - cursor.x, wp.y - cursor.y) * zoom;
        if (distancePx < nearestExistingDistancePx) {
          nearestExistingDistancePx = distancePx;
          nearestExistingIndex = i;
        }
      }
      if (nearestExistingIndex !== -1 && nearestExistingDistancePx < SNAP_TO_EXISTING_PX) {
        // Same live-drag mode a dot's own pointerdown enters — no separate code path to keep
        // in sync, and no insert-pending state left dangling.
        draggingIndex.current = nearestExistingIndex;
        pendingInsert.current = null;
        return;
      }

      const { insertIndex } = nearestPointOnEdgePath(cursor, sourceX, sourceY, targetX, targetY, current);
      pendingInsert.current = { insertIndex, downClientX: evt.clientX, downClientY: evt.clientY };
    },
    [basePoints, onWaypointsChange, screenToFlowPosition, sourceX, sourceY, targetX, targetY, zoom],
  );

  const onPathPointerMove = useCallback(
    (evt: ReactPointerEvent<SVGPathElement>) => {
      if (!onWaypointsChange) return;
      if (draggingIndex.current !== null) {
        // Already committed earlier in this same gesture — keep tracking the inserted point.
        const position = screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
        const next = basePoints().slice();
        next[draggingIndex.current] = position;
        emit(next);
        return;
      }
      const pending = pendingInsert.current;
      if (!pending) return;
      const movedPx = Math.hypot(evt.clientX - pending.downClientX, evt.clientY - pending.downClientY);
      if (movedPx < INSERT_MOVE_THRESHOLD_PX) return;
      const position = screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
      const next = basePoints().slice();
      next.splice(pending.insertIndex, 0, position);
      draggingIndex.current = pending.insertIndex;
      pendingInsert.current = null;
      emit(next);
    },
    [basePoints, emit, onWaypointsChange, screenToFlowPosition],
  );

  const onPathPointerUp = useCallback(
    (evt: ReactPointerEvent<SVGPathElement>) => {
      evt.currentTarget.releasePointerCapture(evt.pointerId);
      pendingInsert.current = null;
      if (draggingIndex.current === null) return;
      const index = draggingIndex.current;
      draggingIndex.current = null;
      commitAndCheckRemoval(index);
    },
    [commitAndCheckRemoval],
  );

  return (
    <>
      <g className="bn-edge" data-risk={isRisk || undefined} data-selected={selected || undefined} style={{ opacity: dimmed ? 0.1 : 1 }}>
        {/* Risk edges get a wider click target than plain ones — they're the ones RiskPopover
            exists for, and real usage on the 100-edge stress fixture found the default width too
            easy to miss, especially where several edges cross near each other. */}
        <BaseEdge id={id} path={d} {...(markerEnd ? { markerEnd } : {})} className="bn-edge-line" interactionWidth={isRisk ? 32 : 20} />
        {onWaypointsChange && (
          <path
            d={d}
            className="bn-edge-grab"
            onPointerDown={onPathPointerDown}
            onPointerMove={onPathPointerMove}
            onPointerUp={onPathPointerUp}
            onPointerCancel={onPathPointerUp}
          />
        )}
        <circle className="bn-edge-port" cx={sourceX} cy={sourceY} r={3.2} />
        <circle className="bn-edge-port" cx={targetX} cy={targetY} r={3.2} />
        {isRisk && (
          <g className="bn-edge-badge" transform={`translate(${mx}, ${my})`} aria-hidden="true">
            <circle r={9.5} className="bn-edge-badge-circle" />
            <text textAnchor="middle" dy="4" className="bn-edge-badge-text">
              !
            </text>
          </g>
        )}
      </g>
      {onWaypointsChange &&
        // Index as key is deliberate, not an oversight: these points carry no identity of
        // their own beyond position (plain {x,y} tuples), WaypointHandle is a pure function of
        // its props with no internal state or effects that depend on identity persisting
        // across a reorder, and at most ONE handle is ever mid-gesture at a time in this
        // design — an inserted point shifting later indices causes no correctness issue, only
        // (at most) a marginally less efficient reconcile.
        displayWaypoints.map((position, index) => (
          <WaypointHandle
            key={index}
            position={position}
            isRisk={isRisk}
            onPointerDown={onDotPointerDown(index)}
            onPointerMove={onDotPointerMove}
            onPointerUp={onDotPointerUp}
            onPointerCancel={onDotPointerUp}
          />
        ))}
    </>
  );
}

/** Renders through EdgeLabelRenderer — a React-Flow-provided portal into a single shared HTML
 * layer positioned ABOVE every edge's SVG, not inline as another child of this edge's own
 * `<g>` (an earlier version tried that: an SVG circle, however late in DOM order within its
 * OWN edge group, still loses hit-testing to a DIFFERENT, unrelated edge's wide invisible
 * interaction stroke landing on the same screen point — SVG paint order is document-order
 * across the WHOLE graph, not scoped per-edge). Every handle across every edge portals into
 * the same later-in-DOM HTML layer, so no edge's SVG can ever bury one. RiskEdge.css's
 * `.react-flow__edgelabel-renderer { z-index: 1000 }` closes the equivalent gap against NODE
 * cards (React Flow's own fixed layer order paints `.react-flow__nodes` above this one by
 * default — any edge whose midpoint visually passes under an unrelated block hits this too). */
function WaypointHandle({
  position,
  isRisk,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  position: Position;
  isRisk: boolean;
  onPointerDown: (evt: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (evt: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (evt: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (evt: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  // EdgeLabelRenderer's shared layer sits inside the SAME pannable/zoomable
  // `.react-flow__viewport` every node/edge does, so a plain `translate(x, y)` alone would
  // still shrink to an unusably tiny on-screen target at heavy zoom-out. `scale(1 / zoom)` is
  // React Flow's own documented technique for a zoom-independent overlay widget — this keeps
  // the handle's actual on-screen size constant regardless of how far out the canvas is zoomed.
  const { zoom } = useViewport();
  return (
    <EdgeLabelRenderer>
      <div
        className="bn-edge-waypoint-handle nopan"
        data-risk={isRisk || undefined}
        style={{ transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) scale(${1 / zoom})` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    </EdgeLabelRenderer>
  );
}
