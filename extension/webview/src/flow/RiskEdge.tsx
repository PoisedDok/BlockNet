import type { EdgeProps, Edge } from '@xyflow/react';
import { BaseEdge } from '@xyflow/react';
import { buildEdgePath } from './edge-path.js';
import './RiskEdge.css';

export type RiskEdgeData = {
  isRisk: boolean;
  dimmed: boolean;
};

export type RiskEdgeType = Edge<RiskEdgeData, 'risk'>;

export function RiskEdge({ id, sourceX, sourceY, targetX, targetY, data, selected, markerEnd }: EdgeProps<RiskEdgeType>) {
  const isRisk = data?.isRisk ?? false;
  const dimmed = data?.dimmed ?? false;
  const { d, mx, my } = buildEdgePath(sourceX, sourceY, targetX, targetY);

  return (
    <g className="bn-edge" data-risk={isRisk || undefined} data-selected={selected || undefined} style={{ opacity: dimmed ? 0.1 : 1 }}>
      {/* Risk edges get a wider click target than plain ones — they're the ones RiskPopover
          exists for, and real usage on the 100-edge stress fixture found the default width too
          easy to miss, especially where several edges cross near each other. */}
      <BaseEdge id={id} path={d} {...(markerEnd ? { markerEnd } : {})} className="bn-edge-line" interactionWidth={isRisk ? 32 : 20} />
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
  );
}
