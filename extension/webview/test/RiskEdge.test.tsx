import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { EdgeProps } from '@xyflow/react';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { RiskEdge, type RiskEdgeType } from '../src/flow/RiskEdge.js';

function edgeProps(overrides: Partial<EdgeProps<RiskEdgeType>> = {}): EdgeProps<RiskEdgeType> {
  return {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: 30,
    targetX: 300,
    targetY: 30,
    sourcePosition: 'right' as never,
    targetPosition: 'left' as never,
    selected: false,
    data: { isRisk: false, dimmed: false },
    ...overrides,
  } as EdgeProps<RiskEdgeType>;
}

// RiskEdge is otherwise a prop-driven SVG renderer, but ROADMAP-V2.md's draggable/bendable
// edge routing added two real React Flow context dependencies: useReactFlow().
// screenToFlowPosition (throws "no ReactFlowProvider as an ancestor" if called outside one,
// even for an edge with no onWaypointsChange at all, since the hook itself is called
// unconditionally — rules of hooks), and EdgeLabelRenderer (the drag handle's actual host — a
// portal into React Flow's OWN shared overlay div, which only exists once a real <ReactFlow>
// instance has mounted and populated the store's `domNode`; a bare <ReactFlowProvider> alone
// does not set that up, confirmed live — WaypointHandle silently rendered nothing at all
// without this). A real (otherwise-empty) <ReactFlow> sibling is enough to satisfy both,
// while this file's own hand-crafted EdgeProps (predictable, exact sourceX/Y/targetX/Y) still
// drive RiskEdge directly rather than depending on real node layout math.
function renderEdge(props: EdgeProps<RiskEdgeType>) {
  return render(
    <ReactFlowProvider>
      <ReactFlow nodes={[]} edges={[]} />
      <svg>
        <RiskEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

describe('RiskEdge', () => {
  it('renders a visible path between the two anchor points', () => {
    const { container } = renderEdge(edgeProps());
    const path = container.querySelector('.bn-edge-path, .react-flow__edge-path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('d')).toContain('M 0 30');
  });

  it('renders a port circle at each endpoint', () => {
    const { container } = renderEdge(edgeProps());
    const circles = container.querySelectorAll('circle.bn-edge-port');
    expect(circles).toHaveLength(2);
    expect(circles[0]?.getAttribute('cx')).toBe('0');
    expect(circles[1]?.getAttribute('cx')).toBe('300');
  });

  it('does not render a risk badge for a non-risk edge', () => {
    const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false } }));
    expect(container.querySelector('.bn-edge-badge')).toBeNull();
  });

  it('renders a "!" risk badge at the true midpoint for a risky edge with no waypoints', () => {
    const { container, getByText } = renderEdge(edgeProps({ data: { isRisk: true, dimmed: false } }));
    expect(getByText('!')).toBeInTheDocument();
    const badge = container.querySelector('.bn-edge-badge');
    expect(badge?.getAttribute('transform')).toBe('translate(150, 30)');
  });

  it('marks the edge group data-risk for CSS styling when risky', () => {
    const { container } = renderEdge(edgeProps({ data: { isRisk: true, dimmed: false } }));
    expect(container.querySelector('g.bn-edge')?.hasAttribute('data-risk')).toBe(true);
  });

  it('dims a non-related edge via inline opacity', () => {
    const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: true } }));
    const group = container.querySelector('g.bn-edge') as HTMLElement;
    expect(group.style.opacity).toBe('0.1');
  });

  describe('multi-point waypoint dragging (ROADMAP-V2.md, "grab the line directly")', () => {
    it('renders no grab path and no handles when onWaypointsChange is absent', () => {
      const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, waypoints: [{ x: 100, y: 60 }] } }));
      expect(container.querySelector('.bn-edge-grab')).toBeNull();
      expect(container.querySelector('.bn-edge-waypoint-handle')).toBeNull();
    });

    it('renders no waypoint handle at all when there are no waypoints yet (no permanent ghost handle)', () => {
      const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, onWaypointsChange: vi.fn() } }));
      expect(container.querySelector('.bn-edge-waypoint-handle')).toBeNull();
      // The grab affordance (the line itself) is present even with zero waypoints — that's how
      // the FIRST one gets created.
      expect(container.querySelector('.bn-edge-grab')).not.toBeNull();
    });

    it('renders exactly one handle per existing waypoint, at its exact position — no risk-only offset', () => {
      const waypoints = [
        { x: 80, y: 60 },
        { x: 220, y: 10 },
      ];
      const { container } = renderEdge(edgeProps({ data: { isRisk: true, dimmed: false, waypoints, onWaypointsChange: vi.fn() } }));
      const handles = container.querySelectorAll('.bn-edge-waypoint-handle');
      expect(handles).toHaveLength(2);
      // Positions match the raw waypoint coordinates exactly — the original design's
      // RISK_HANDLE_OFFSET_Y (+24 in Y for risky edges only, so the handle floated away from
      // the true bend point) is gone. Risk and non-risk edges now place their handles
      // identically; only the color differs (via CSS's [data-risk] selector).
      expect((handles[0] as HTMLElement).style.transform).toBe('translate(-50%, -50%) translate(80px, 60px) scale(1)');
      expect((handles[1] as HTMLElement).style.transform).toBe('translate(-50%, -50%) translate(220px, 10px) scale(1)');
    });

    it('dragging an existing handle moves it, calling onWaypointsChange with the updated array', () => {
      const onWaypointsChange = vi.fn();
      const waypoints = [{ x: 150, y: 30 }];
      const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, waypoints, onWaypointsChange } }));
      const handle = container.querySelector('.bn-edge-waypoint-handle') as Element;
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 150, clientY: 30 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 160, clientY: 90 });
      expect(onWaypointsChange).toHaveBeenCalledTimes(1);
      expect(onWaypointsChange).toHaveBeenCalledWith([{ x: 160, y: 90 }]);
    });

    it('does not move a handle on a move that happens before any pointerdown', () => {
      const onWaypointsChange = vi.fn();
      const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, waypoints: [{ x: 150, y: 30 }], onWaypointsChange } }));
      const handle = container.querySelector('.bn-edge-waypoint-handle') as Element;
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200, clientY: 90 });
      expect(onWaypointsChange).not.toHaveBeenCalled();
    });

    it('removes a waypoint when dragged back onto the straight line between its neighbors', () => {
      const onWaypointsChange = vi.fn();
      // sourceY=targetY=30 — the straight source→target line is y=30 for all x. Dragging the
      // single waypoint back to (150, 32) lands well within REMOVE_DISTANCE (14) of that line.
      const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, waypoints: [{ x: 150, y: 200 }], onWaypointsChange } }));
      const handle = container.querySelector('.bn-edge-waypoint-handle') as Element;
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 150, clientY: 200 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150, clientY: 32 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150, clientY: 32 });
      // Move commits [{x:150,y:32}], then the release check removes it → final call is [].
      expect(onWaypointsChange).toHaveBeenLastCalledWith([]);
    });

    it('removes only the dragged waypoint, keeping siblings intact', () => {
      const onWaypointsChange = vi.fn();
      const waypoints = [
        { x: 80, y: 60 },
        { x: 220, y: 200 },
      ];
      const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, waypoints, onWaypointsChange } }));
      const secondHandle = container.querySelectorAll('.bn-edge-waypoint-handle')[1] as Element;
      fireEvent.pointerDown(secondHandle, { pointerId: 1, clientX: 220, clientY: 200 });
      // Drag it onto the line between waypoint[0]=(80,60) and target=(300,30).
      fireEvent.pointerMove(secondHandle, { pointerId: 1, clientX: 220, clientY: 44 });
      fireEvent.pointerUp(secondHandle, { pointerId: 1, clientX: 220, clientY: 44 });
      expect(onWaypointsChange).toHaveBeenLastCalledWith([{ x: 80, y: 60 }]);
    });

    it('collapses (removes) a waypoint dragged directly onto its own adjacent neighbor, not just onto the straight line', () => {
      // A previously-flagged, since-verified-non-issue: commitAndCheckRemoval only checks
      // distanceToSegment(curr, prev, next) against the straight line between neighbors, with
      // no separate "distance to a specific neighbor point" check. But distance-to-a-SEGMENT is
      // mathematically bounded above by distance to either of its own endpoints — and prev/next
      // ARE the segment's endpoints — so landing on/near an adjacent waypoint is already a
      // strict subcase of "near the line," not a gap. This pins that down as tested behavior.
      const onWaypointsChange = vi.fn();
      const waypoints = [
        { x: 80, y: 60 },
        { x: 220, y: 10 },
      ];
      const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, waypoints, onWaypointsChange } }));
      const secondHandle = container.querySelectorAll('.bn-edge-waypoint-handle')[1] as Element;
      fireEvent.pointerDown(secondHandle, { pointerId: 1, clientX: 220, clientY: 10 });
      // Drag waypoint[1] directly onto waypoint[0]'s exact position, not onto the source/target line.
      fireEvent.pointerMove(secondHandle, { pointerId: 1, clientX: 80, clientY: 60 });
      fireEvent.pointerUp(secondHandle, { pointerId: 1, clientX: 80, clientY: 60 });
      expect(onWaypointsChange).toHaveBeenLastCalledWith([{ x: 80, y: 60 }]);
    });

    it('keeps the waypoint (never removes it) when released far from the line between its neighbors', () => {
      const onWaypointsChange = vi.fn();
      const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, waypoints: [{ x: 150, y: 30 }], onWaypointsChange } }));
      const handle = container.querySelector('.bn-edge-waypoint-handle') as Element;
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 150, clientY: 30 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150, clientY: 200 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150, clientY: 200 });
      expect(onWaypointsChange).toHaveBeenLastCalledWith([{ x: 150, y: 200 }]);
    });

    describe('grabbing the line itself to create a new waypoint', () => {
      it('does nothing on pointerdown alone — a plain click must not insert a point', () => {
        const onWaypointsChange = vi.fn();
        const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, onWaypointsChange } }));
        const path = container.querySelector('.bn-edge-grab') as Element;
        fireEvent.pointerDown(path, { pointerId: 1, clientX: 150, clientY: 30 });
        fireEvent.pointerUp(path, { pointerId: 1, clientX: 150, clientY: 30 });
        expect(onWaypointsChange).not.toHaveBeenCalled();
      });

      it('does not insert a point for movement under the threshold (still just a click)', () => {
        const onWaypointsChange = vi.fn();
        const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, onWaypointsChange } }));
        const path = container.querySelector('.bn-edge-grab') as Element;
        fireEvent.pointerDown(path, { pointerId: 1, clientX: 150, clientY: 30 });
        fireEvent.pointerMove(path, { pointerId: 1, clientX: 152, clientY: 31 }); // ~2.2px, under 4px threshold
        expect(onWaypointsChange).not.toHaveBeenCalled();
      });

      it('inserts a new waypoint once movement crosses the threshold, positioned on the curve near the drag', () => {
        const onWaypointsChange = vi.fn();
        const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, onWaypointsChange } }));
        const path = container.querySelector('.bn-edge-grab') as Element;
        fireEvent.pointerDown(path, { pointerId: 1, clientX: 150, clientY: 30 });
        fireEvent.pointerMove(path, { pointerId: 1, clientX: 150, clientY: 90 });
        expect(onWaypointsChange).toHaveBeenCalledTimes(1);
        const [inserted] = onWaypointsChange.mock.calls[0]![0] as { x: number; y: number }[];
        expect(inserted!.x).toBe(150);
        expect(inserted!.y).toBe(90);
      });

      it('continues tracking the just-inserted point on further movement within the same gesture', () => {
        const onWaypointsChange = vi.fn();
        const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, onWaypointsChange } }));
        const path = container.querySelector('.bn-edge-grab') as Element;
        fireEvent.pointerDown(path, { pointerId: 1, clientX: 150, clientY: 30 });
        fireEvent.pointerMove(path, { pointerId: 1, clientX: 150, clientY: 90 });
        fireEvent.pointerMove(path, { pointerId: 1, clientX: 160, clientY: 120 });
        expect(onWaypointsChange).toHaveBeenLastCalledWith([{ x: 160, y: 120 }]);
      });

      it('inserts a click-without-real-movement point and then removes it again on release (net no-op)', () => {
        // The point nearestPointOnEdgePath finds for a click ON the unbent curve is, by
        // definition, extremely close to collinear with the curve's own shape — so even
        // though the threshold gate mostly prevents this, a click landing exactly on a
        // sampled curve point that JUST crosses the threshold should still self-correct via
        // the same removal check every other drag goes through, not leave a stray one-pixel
        // "bend" behind.
        const onWaypointsChange = vi.fn();
        const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false, onWaypointsChange } }));
        const path = container.querySelector('.bn-edge-grab') as Element;
        fireEvent.pointerDown(path, { pointerId: 1, clientX: 150, clientY: 30 });
        fireEvent.pointerMove(path, { pointerId: 1, clientX: 155, clientY: 30 }); // crosses 4px threshold, lands ON the straight-ish curve
        fireEvent.pointerUp(path, { pointerId: 1, clientX: 155, clientY: 30 });
        expect(onWaypointsChange).toHaveBeenLastCalledWith([]);
      });

      it('inserts at index 0 for a drag near the first segment when a waypoint already exists', () => {
        const onWaypointsChange = vi.fn();
        const { container } = renderEdge(
          edgeProps({ data: { isRisk: false, dimmed: false, waypoints: [{ x: 150, y: 30 }], onWaypointsChange } }),
        );
        const path = container.querySelector('.bn-edge-grab') as Element;
        fireEvent.pointerDown(path, { pointerId: 1, clientX: 40, clientY: 30 });
        fireEvent.pointerMove(path, { pointerId: 1, clientX: 40, clientY: 90 });
        const result = onWaypointsChange.mock.calls[0]![0] as { x: number; y: number }[];
        expect(result).toHaveLength(2);
        expect(result[1]).toEqual({ x: 150, y: 30 }); // the pre-existing waypoint stays second
      });

      it('inserts at index 1 for a drag near the second segment when a waypoint already exists', () => {
        const onWaypointsChange = vi.fn();
        const { container } = renderEdge(
          edgeProps({ data: { isRisk: false, dimmed: false, waypoints: [{ x: 150, y: 30 }], onWaypointsChange } }),
        );
        const path = container.querySelector('.bn-edge-grab') as Element;
        fireEvent.pointerDown(path, { pointerId: 1, clientX: 260, clientY: 30 });
        fireEvent.pointerMove(path, { pointerId: 1, clientX: 260, clientY: 90 });
        const result = onWaypointsChange.mock.calls[0]![0] as { x: number; y: number }[];
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ x: 150, y: 30 }); // the pre-existing waypoint stays first
      });
    });
  });
});
