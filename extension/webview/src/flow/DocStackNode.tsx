import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { LayerDocFile } from '@blocknet/core';
import { DocStackCard } from './DocStackCard.js';

export type DocStackNodeData = {
  files: LayerDocFile[];
  dimmed: boolean;
};

export type DocStackNodeType = Node<DocStackNodeData, 'docstack'>;

// Identical Handle placement to FileNode.tsx — a doc-stack never participates in intra-layer
// edges (doc files never appear in FileEdge[] regardless, core/src/analyze-layer.ts's own
// comment), but keeps the same anchor shape as every other node type for layout consistency.
export function DocStackNode({ data, selected }: NodeProps<DocStackNodeType>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, top: 26 }} />
      <DocStackCard count={data.files.length} selected={!!selected} dimmed={data.dimmed} interactive={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, top: 26 }} />
    </>
  );
}
