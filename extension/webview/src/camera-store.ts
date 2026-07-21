import { useCallback, useEffect, useRef, useState } from 'react';
import type { Position } from './flow/layout.js';
import { postToHost } from './host-bridge.js';

const PERSIST_DEBOUNCE_MS = 300;

/** Owns the webview's own view of node positions AND edge waypoints (docs/architecture/
 * FLOWS.md §4, STATE-OWNERSHIP.md): both seeded from the host's layout/restore payload, both
 * updated optimistically as the user interacts (BlockCanvas.tsx's onNodesChange for positions,
 * RiskEdge.tsx's drag handle for waypoints — ROADMAP-V2.md's draggable/bendable edge routing),
 * and debounced back to the host as ONE combined layout/persist message so a flurry of
 * drag-frame updates to either becomes one workspaceState write, not one per pixel moved. Kept
 * as a single hook/message rather than two independent ones: they're the same conceptual event
 * ("the user repositioned something in the graph, please persist it") and sharing one debounce
 * timer means a position drag and a waypoint drag happening close together in time coalesce
 * into one persist instead of two racing, independently-debounced writes to the same
 * workspaceState-backed host.
 *
 * Both maps are deliberately sparse, same as what layout/restore hands back: only ids this
 * session (or a prior one) has actually moved, never a full snapshot of layout.ts's dagre
 * output or every edge in the graph — see layout.ts's own comment for why new/unmoved blocks
 * must keep falling through to a fresh dagre position instead of a stale persisted one; the
 * identical reasoning applies to an edge with no waypoint override falling through to its
 * plain geometric-midpoint curve.
 *
 * `persist` defaults to posting the macro `layout/persist` message (BlockCanvas.tsx's own
 * call site never passes one). GraphView.tsx calls this hook a SECOND, independent time for
 * file-level drag parity (ROADMAP-V2.md), supplying a persist callback that posts
 * `layout/file-persist` instead — a different message shape/workspaceState-key pair, not two
 * more fields on the same one (see protocol.ts's own comment for why), so the two hook
 * instances' debounce timers stay fully independent and neither's persist can be mistaken for
 * the other's by the host. */
export function useCameraStore(
  initialPositions: Record<string, Position>,
  initialEdgeWaypoints: Record<string, Position[]> = {},
  persist: (positions: Record<string, Position>, edgeWaypoints: Record<string, Position[]>) => void = (positions, edgeWaypoints) =>
    postToHost({ type: 'layout/persist', positions, edgeWaypoints }),
) {
  const [positions, setPositions] = useState(initialPositions);
  const [edgeWaypoints, setEdgeWaypoints] = useState(initialEdgeWaypoints);
  const isFirstRender = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Kept current via its own effect (never written during render — React's rules-of-hooks
  // lint correctly flags a direct `ref.current = x` in the render body as unsafe under
  // concurrent rendering) so the unmount-only flush below can read the latest values without
  // capturing a stale value from whichever render happened to set up that effect.
  const positionsRef = useRef(positions);
  const edgeWaypointsRef = useRef(edgeWaypoints);
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);
  useEffect(() => {
    edgeWaypointsRef.current = edgeWaypoints;
  }, [edgeWaypoints]);
  // `persist` kept current via a ref, same reasoning as positionsRef/edgeWaypointsRef above,
  // and — load-bearing here, not just consistency — deliberately NOT in the debounce effect's
  // own dependency array below. GraphView.tsx's file-camera-store call site passes an inline
  // arrow function (a fresh identity every render); including it as a dependency would clear
  // and restart the pending debounce timer on every one of GraphView's re-renders, not just on
  // an actual position/waypoint change — starving the debounce so it could go arbitrarily long
  // without ever firing under any real render cadence. Reading the latest value through a ref
  // means a fresh callback identity is picked up for the NEXT persist without ever resetting an
  // already-pending timer.
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const movePosition = useCallback((id: string, position: Position) => {
    setPositions((prev) => ({ ...prev, [id]: position }));
  }, []);

  /** An empty array removes the edge's override entirely (RiskEdge.tsx's own removal logic —
   * dragging the last/only remaining bend point back onto the straight line between its
   * neighbors) rather than pinning a redundant empty-array entry — the same "absent id falls
   * through to the computed default" contract layout/restore's positions map already
   * establishes. `waypoints` is always the FULL replacement array for that edge (multi-point
   * drag parity, ROADMAP-V2.md) — RiskEdge.tsx owns insert/move/remove entirely internally and
   * always hands back the complete resulting array, never a single point to merge. */
  const moveWaypoints = useCallback((edgeId: string, waypoints: Position[]) => {
    setEdgeWaypoints((prev) => {
      if (waypoints.length === 0) {
        if (!(edgeId in prev)) return prev; // already absent — no-op, don't force a re-render
        const next = { ...prev };
        delete next[edgeId];
        return next;
      }
      return { ...prev, [edgeId]: waypoints };
    });
  }, []);

  useEffect(() => {
    // Skip the mount-time effect run — both maps here are still exactly what layout/restore
    // handed in, so persisting them back would be a wasted (if harmless) round-trip on every
    // single panel open.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      persistRef.current(positions, edgeWaypoints);
    }, PERSIST_DEBOUNCE_MS);
  }, [positions, edgeWaypoints]);

  // Separate, mount-once effect so its cleanup only ever runs on a genuine unmount, not on
  // every intermediate change the debounce effect above already handles — a combined effect's
  // cleanup can't tell those two cases apart. Without this, a debounce still pending when the
  // component actually unmounts (BlockCanvas re-rendering because a live graph/macro update
  // swapped it out, or the panel closing mid-drag) silently loses up to 300ms of the most
  // recent drag movement instead of persisting it — a real gap two-pass review found for
  // positions alone; the identical gap would apply to waypoints if this weren't shared.
  useEffect(() => {
    return () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        persistRef.current(positionsRef.current, edgeWaypointsRef.current);
      }
    };
  }, []);

  return { positions, movePosition, edgeWaypoints, moveWaypoints };
}
