import { describe, expect, it } from 'vitest';
import { buildEdgePath } from '../src/flow/edge-path.js';

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
});
