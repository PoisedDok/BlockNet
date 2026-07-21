import { describe, expect, it } from 'vitest';
import { buildEdgePath, distanceToSegment, nearestPointOnEdgePath } from '../src/flow/edge-path.js';

describe('buildEdgePath', () => {
  it('starts and ends the path at the given anchor points', () => {
    const { d } = buildEdgePath(0, 0, 300, 0);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('300 0')).toBe(true);
  });

  it('returns the true midpoint of the two anchors', () => {
    const { mx, my } = buildEdgePath(0, 0, 300, 200);
    expect(mx).toBe(150);
    expect(my).toBe(100);
  });

  it('uses a minimum horizontal control-point offset of 52 for close nodes', () => {
    // dx = max(52, |Δx| * 0.5) — mirrors design_handoff's pathOf exactly (visual parity).
    const { d } = buildEdgePath(0, 0, 40, 0);
    expect(d).toContain('C 52 0, -12 0, 40 0');
  });

  it('scales the control-point offset with horizontal distance beyond the minimum', () => {
    const { d } = buildEdgePath(0, 0, 400, 0);
    expect(d).toContain('C 200 0, 200 0, 400 0');
  });

  it('caps the control-point offset for a very distant target instead of scaling unbounded', () => {
    const { d } = buildEdgePath(0, 0, 2000, 0);
    expect(d).toContain('C 220 0, 1780 0, 2000 0');
  });

  it('caps the control-point offset for a BACKWARDS edge (target to the left of source) instead of blowing out far past the viewport', () => {
    // Real, live-caught bug: a reciprocal edge pair (A→B and B→A) in a real repo's real import
    // cycle has one direction going right-to-left relative to the layout's LR flow. The
    // uncapped `|Δx| * 0.5` formula computed a dx of 309 for a real 618px-apart backwards
    // pair, pushing control points to x=924 and x=-312 — hundreds of px past either node,
    // invisible at rest (the curve stays flat when source/target share the same y) but
    // exploding into a huge, visibly self-crossing loop the instant any waypoint gives it a
    // y-offset. Confirmed live via Playwright against the real sample fixture's auth→gateway
    // edge, not a synthetic case.
    const { d } = buildEdgePath(615, 30, -3, 30);
    expect(d).toContain('C 835 30, -223 30, -3 30');
  });

  describe('with waypoints (draggable/bendable multi-point edge routing, ROADMAP-V2.md)', () => {
    it('stitches two cubic segments through a single waypoint instead of one straight-through curve', () => {
      const { d } = buildEdgePath(0, 0, 300, 0, [{ x: 150, y: 80 }]);
      expect(d.startsWith('M 0 0')).toBe(true);
      // Passes exactly through the waypoint as an on-curve point shared by both segments —
      // the first segment's end coordinate and the second segment's start coordinate.
      expect(d).toContain('150 80 C');
      expect(d.endsWith('300 0')).toBe(true);
    });

    it('stitches THREE cubic segments through two waypoints, in order', () => {
      const { d } = buildEdgePath(0, 0, 300, 0, [
        { x: 80, y: 60 },
        { x: 200, y: -40 },
      ]);
      // Every waypoint appears as an on-curve point, source-to-target order preserved.
      const iFirst = d.indexOf('80 60');
      const iSecond = d.indexOf('200 -40');
      expect(iFirst).toBeGreaterThan(-1);
      expect(iSecond).toBeGreaterThan(iFirst);
      expect(d.endsWith('300 0')).toBe(true);
      expect((d.match(/ C /g) ?? []).length).toBe(3);
    });

    it('reports the single waypoint itself as mx/my, not the geometric midpoint', () => {
      const { mx, my } = buildEdgePath(0, 0, 300, 200, [{ x: 40, y: 190 }]);
      expect(mx).toBe(40);
      expect(my).toBe(190);
    });

    it('reports the middle point among source/waypoints/target as mx/my for an odd total count', () => {
      // points = [source, wp0, wp1, target] (4 entries) → middle index floor(4/2)=2 → wp1.
      const { mx, my } = buildEdgePath(0, 0, 300, 0, [
        { x: 80, y: 60 },
        { x: 200, y: -40 },
      ]);
      expect(mx).toBe(200);
      expect(my).toBe(-40);
    });

    it('is byte-for-byte identical to the no-waypoint path when waypoints is undefined', () => {
      const withoutWaypoints = buildEdgePath(0, 0, 300, 200);
      const withUndefinedWaypoints = buildEdgePath(0, 0, 300, 200, undefined);
      expect(withUndefinedWaypoints).toEqual(withoutWaypoints);
    });

    it('is byte-for-byte identical to the no-waypoint path when waypoints is an empty array', () => {
      const withoutWaypoints = buildEdgePath(0, 0, 300, 200);
      const withEmptyWaypoints = buildEdgePath(0, 0, 300, 200, []);
      expect(withEmptyWaypoints).toEqual(withoutWaypoints);
    });
  });
});

describe('nearestPointOnEdgePath (grab-the-path-directly waypoint insertion)', () => {
  it('finds a point near the unbent curve and reports insertIndex 0 (the only segment)', () => {
    const result = nearestPointOnEdgePath({ x: 150, y: 40 }, 0, 0, 300, 0, []);
    expect(result.insertIndex).toBe(0);
    // The unbent curve at its horizontal midpoint sits near y=0 (a shallow S-curve for a
    // straight horizontal span) — the nearest sampled point should be close to the click.
    expect(result.distance).toBeLessThan(45);
  });

  it('reports insertIndex 0 for a click near the FIRST segment when one waypoint already exists', () => {
    const result = nearestPointOnEdgePath({ x: 40, y: 10 }, 0, 0, 300, 0, [{ x: 150, y: 0 }]);
    expect(result.insertIndex).toBe(0);
  });

  it('reports insertIndex 1 for a click near the SECOND segment when one waypoint already exists', () => {
    const result = nearestPointOnEdgePath({ x: 260, y: 10 }, 0, 0, 300, 0, [{ x: 150, y: 0 }]);
    expect(result.insertIndex).toBe(1);
  });

  it('reports insertIndex 2 for a click near the THIRD segment when two waypoints already exist', () => {
    const result = nearestPointOnEdgePath({ x: 280, y: 10 }, 0, 0, 300, 0, [
      { x: 80, y: 0 },
      { x: 200, y: 0 },
    ]);
    expect(result.insertIndex).toBe(2);
  });

  it('returns a position ON the sampled curve, not the raw click position', () => {
    // Click far off-curve (y=500) — the reported position should snap to the curve, not the
    // click itself, since this drives "where the new waypoint actually starts."
    const result = nearestPointOnEdgePath({ x: 150, y: 500 }, 0, 0, 300, 0, []);
    expect(Math.abs(result.position.y)).toBeLessThan(50);
  });

  it('samples the SAME curve buildEdgePath actually renders for a long backwards edge past the control-point cap', () => {
    // Regression for a real divergence bug: segmentControlPoints() used to re-derive the
    // control-point offset with its own uncapped copy of the formula instead of calling
    // buildEdgePath's controlPointOffset(), so for any edge long/backward enough to hit
    // MAX_CONTROL_POINT_OFFSET, the curve this function samples for click/drag hit-testing
    // silently diverged from the curve actually drawn on screen (by ~30px in the case that
    // exposed it). t=0.5 is a poor probe here — the cubic's control-point terms cancel exactly
    // at the midpoint by symmetry regardless of dx, so it can't distinguish capped from
    // uncapped. t=0.25 (sample index 6 of 24) does not have that cancellation: with the
    // correct capped dx=220 the point is at x=580.3125; with the old uncapped dx=309 (computed
    // the same way `buildEdgePath`'s "BACKWARDS edge" test above derives its own expected
    // control points) it lands at x=605.34375 instead — a ~25px divergence, reproducing the
    // reviewer's measurement.
    const result = nearestPointOnEdgePath({ x: 580.3125, y: 30 }, 615, 30, -3, 30, []);
    expect(result.distance).toBeLessThan(1);
  });
});

describe('distanceToSegment (waypoint-removal-by-straightening)', () => {
  it('returns 0 for a point exactly on the segment', () => {
    expect(distanceToSegment({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(0);
  });

  it('returns the perpendicular distance for a point off to the side of the segment', () => {
    expect(distanceToSegment({ x: 50, y: 30 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(30);
  });

  it('clamps to the nearest ENDPOINT, not the infinite line, past either end', () => {
    // (150, 0) is past b=(100,0) along the line — nearest point on the SEGMENT is b itself,
    // distance 50, not 0 (which the infinite-line formula would wrongly give).
    expect(distanceToSegment({ x: 150, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(50);
  });

  it('handles a zero-length segment (coincident endpoints) as a plain point distance', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});
