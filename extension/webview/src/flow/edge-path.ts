export type EdgePath = { d: string; mx: number; my: number };

/** Cubic-bezier port→port path — an exact port of design_handoff_blocknet_extension's own
 * pathOf() (BlockNet.dc.html), not React Flow's generic getBezierPath, because visual parity
 * with the design reference (docs/planning/TASKS-V1.md's Task 7 acceptance criteria) depends
 * on this specific curvature: horizontal-only control points, offset floored at 52px so
 * adjacent cards still get a visible curve instead of a near-straight line. */
export function buildEdgePath(sx: number, sy: number, tx: number, ty: number): EdgePath {
  const dx = Math.max(52, Math.abs(tx - sx) * 0.5);
  return {
    d: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
    mx: (sx + tx) / 2,
    my: (sy + ty) / 2,
  };
}
