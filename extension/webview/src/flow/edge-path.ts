import type { Position } from '../../../src/shared/protocol.js';

export type EdgePath = { d: string; mx: number; my: number };

// Floored at 52 so adjacent cards still get a visible curve instead of a near-straight line;
// CAPPED at 220 — a real, live-caught bug, not a defensive guess: the uncapped
// `Math.abs(tx - sx) * 0.5` grows without bound for a BACKWARDS edge (target to the left of
// source in an LR layout — a real, reachable case for a reciprocal cycle: A→B flows normally,
// B→A is the "backwards" direction of the exact same pair). A real 618px-apart backwards edge
// computed dx=309, pushing control points to x=924 and x=-312 — hundreds of px past either
// node. Invisible at rest (a same-y source/target keeps the curve visually flat regardless of
// how extreme its control points are), but the instant a waypoint gives that edge ANY
// y-offset, the curve visibly bulges into a huge, self-crossing loop — confirmed live against
// the sample fixture's real auth→gateway edge. The cap keeps every edge's curve contained to a
// sane, on-screen shape regardless of direction or distance.
const MAX_CONTROL_POINT_OFFSET = 220;

/** The one, single source of truth for the horizontal control-point offset — a real bug,
 * found by an architectural-soundness review after the fact, existed here: this formula was
 * duplicated (not called) into `segmentControlPoints()` below for `nearestPointOnEdgePath`'s
 * own sampling, and the MAX_CONTROL_POINT_OFFSET cap fix was applied to only one of the two
 * copies — leaving the actually-RENDERED curve (via `segment()`) and the curve
 * `nearestPointOnEdgePath` SAMPLES for click/drag hit-testing silently diverged for any edge
 * long/backward enough to hit the cap, by as much as ~30px in the reviewer's own measurement.
 * No live-reachable wrong `insertIndex` was found from this specific divergence, but "two
 * copies of the same formula, only one gets a bugfix" is exactly the maintenance hazard
 * CLAUDE.md's own decisions/0008 exists to prevent — fixed by making both call sites share
 * this one function instead of re-deriving it. */
function controlPointOffset(ax: number, bx: number): number {
  return Math.min(MAX_CONTROL_POINT_OFFSET, Math.max(52, Math.abs(bx - ax) * 0.5));
}

function segment(sx: number, sy: number, tx: number, ty: number): string {
  const dx = controlPointOffset(sx, tx);
  return `${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}

/** Cubic-bezier port→port path — an exact port of design_handoff_blocknet_extension's own
 * pathOf() (BlockNet.dc.html), not React Flow's generic getBezierPath, because visual parity
 * with the design reference (docs/planning/TASKS-V1.md's Task 7 acceptance criteria) depends
 * on this specific curvature: horizontal-only control points, offset floored at 52px so
 * adjacent cards still get a visible curve instead of a near-straight line.
 *
 * `waypoints`, when non-empty (ROADMAP-V2.md's draggable/bendable multi-point edge routing),
 * stitches N+1 of these same cubic segments — source→wp0, wp0→wp1, ..., wpN-1→target — into
 * one path string, rather than a different curve family. This keeps a bent edge visually
 * consistent with every unbent one instead of introducing a second curve style only some edges
 * use, and generalizes the original single-waypoint version (which stitched exactly two
 * segments) without changing its behavior for 0 or 1 waypoints. `mx`/`my` are the "middle"
 * point among [source, ...waypoints, target] — the natural place for the risk badge — which
 * for exactly one waypoint is that waypoint itself, matching the original single-waypoint
 * behavior exactly. */
export function buildEdgePath(sx: number, sy: number, tx: number, ty: number, waypoints?: Position[]): EdgePath {
  if (!waypoints || waypoints.length === 0) {
    return { d: `M ${sx} ${sy} C ${segment(sx, sy, tx, ty)}`, mx: (sx + tx) / 2, my: (sy + ty) / 2 };
  }
  const points: Position[] = [{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }];
  let d = `M ${sx} ${sy}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    d += ` C ${segment(a.x, a.y, b.x, b.y)}`;
  }
  const mid = points[Math.floor(points.length / 2)]!;
  return { d, mx: mid.x, my: mid.y };
}

function cubicPointAt(p0: Position, p1: Position, p2: Position, p3: Position, t: number): Position {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const e = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y };
}

function segmentControlPoints(a: Position, b: Position): [Position, Position, Position, Position] {
  const dx = controlPointOffset(a.x, b.x);
  return [a, { x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }, b];
}

const SAMPLES_PER_SEGMENT = 24;

/** Finds the point on the CURRENT (possibly already-bent) edge path nearest a cursor position,
 * for RiskEdge.tsx's "grab the line directly, drop a new bend point where you clicked" gesture
 * (ROADMAP-V2.md's multi-point drag parity) — the direct replacement for the original design's
 * single, separately-rendered handle dot. Samples every cubic segment via the SAME explicit
 * bezier formula `buildEdgePath` stitches (not the browser's SVGGeometryElement.getPointAtLength,
 * which jsdom doesn't implement at all — this stays a pure function, unit-testable headlessly,
 * matching this project's own established preference for real, run test coverage over live-only
 * verification wherever a browser-only API isn't unavoidable).
 *
 * `insertIndex` is directly the index a new waypoint should be spliced into the waypoints array
 * at: segment `i` connects points[i] to points[i+1] in the `[source, ...waypoints, target]`
 * list, and inserting a new point within that segment means it becomes waypoints[i] — no
 * further translation needed by the caller. Sampling (not a closed-form nearest-point solve —
 * no such closed form exists for a cubic bezier) is standard practice for interactive curve
 * editing and more than sufficient for a pointer-driven drag gesture, where sub-pixel accuracy
 * doesn't matter. */
export function nearestPointOnEdgePath(
  cursor: Position,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  waypoints: Position[],
): { insertIndex: number; position: Position; distance: number } {
  const points: Position[] = [{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }];
  let best: { insertIndex: number; position: Position; distance: number } | undefined;
  for (let seg = 0; seg < points.length - 1; seg++) {
    const [p0, p1, p2, p3] = segmentControlPoints(points[seg]!, points[seg + 1]!);
    for (let i = 0; i <= SAMPLES_PER_SEGMENT; i++) {
      const t = i / SAMPLES_PER_SEGMENT;
      const position = cubicPointAt(p0, p1, p2, p3, t);
      const distance = Math.hypot(position.x - cursor.x, position.y - cursor.y);
      if (!best || distance < best.distance) best = { insertIndex: seg, position, distance };
    }
  }
  // Unreachable in practice: `points` always has at least 2 entries (source, target), so the
  // loop above always runs at least once and `best` is always assigned.
  return best!;
}

/** Shortest distance from `p` to the line SEGMENT a→b (not the infinite line) — the standard
 * "project onto the segment, clamp to its ends" formula. Used by RiskEdge.tsx's drag-release
 * handling: a waypoint dragged back close to the straight line between its two neighbors reads
 * as "un-bend this point," the multi-point generalization of the original single-waypoint
 * design's "drag back near the natural midpoint resets" gesture. */
export function distanceToSegment(p: Position, a: Position, b: Position): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
}
