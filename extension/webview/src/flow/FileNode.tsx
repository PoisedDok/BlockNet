import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { LayerArrow } from '@blocknet/core';
import { FileCard } from './FileCard.js';
import { InterLayerArrows } from './InterLayerArrows.js';

export type FileNodeData = {
  name: string;
  path: string;
  loc: number;
  dirty: boolean;
  risk: boolean;
  dimmed: boolean;
  onOpenInEditor: () => void;
  /** This file's own inter-layer arrows (docs/planning/ROADMAP-V2.md's v2.0.1) — already
   * scoped to this one item by LayerCanvas.tsx's grouping, empty array when none. */
  arrows: LayerArrow[];
  onArrowNavigate: (targetFile: string) => void;
};

export type FileNodeType = Node<FileNodeData, 'file'>;

// Mirrors BlockNode.tsx's adapter shape exactly (invisible/non-interactive Handles used only
// for RiskEdge's port-anchor math, real card rendering delegated to the pure FileCard).
export function FileNode({ data, selected }: NodeProps<FileNodeType>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, top: 26 }} />
      <FileCard
        name={data.name}
        path={data.path}
        loc={data.loc}
        dirty={data.dirty}
        risk={data.risk}
        selected={!!selected}
        dimmed={data.dimmed}
        onOpenInEditor={data.onOpenInEditor}
        interactive={false}
      />
      <InterLayerArrows arrows={data.arrows} onNavigate={data.onArrowNavigate} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, top: 26 }} />
    </>
  );
}
