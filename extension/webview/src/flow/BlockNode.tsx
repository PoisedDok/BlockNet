import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { BlockCard } from './BlockCard.js';

export type BlockNodeData = {
  name: string;
  path: string;
  pills: string[];
  riskCount: number;
  connectionCount: number;
  dirty: boolean;
  dimmed: boolean;
};

export type BlockNodeType = Node<BlockNodeData, 'block'>;

// Handles are RF's own anchor points, used only for edge routing math — the visible "port"
// dot at each edge endpoint is drawn by RiskEdge.tsx itself (matching the design reference's
// SVG-drawn ports), so these stay unstyled/invisible and non-interactive: this graph is a
// read-only view of real imports, not a tool for drawing new ones by hand.
export function BlockNode({ data, selected }: NodeProps<BlockNodeType>) {
  return (
    <>
      {/* top: 30 mirrors the design reference's fixed near-top port anchor (aligned with the
          name row, not the card's vertical center — see docs/decisions/0007) rather than RF's
          default 50%-of-height placement, which would drift as pill-wrapping changes a card's
          rendered height. */}
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, top: 30 }} />
      <BlockCard
        name={data.name}
        path={data.path}
        pills={data.pills}
        riskCount={data.riskCount}
        connectionCount={data.connectionCount}
        dirty={data.dirty}
        selected={!!selected}
        dimmed={data.dimmed}
        interactive={false}
      />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, top: 30 }} />
    </>
  );
}
