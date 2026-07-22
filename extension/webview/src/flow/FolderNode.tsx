import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { LayerArrow } from '@blocknet/core';
import { BlockCard } from './BlockCard.js';
import { InterLayerArrows } from './InterLayerArrows.js';

// v2.0.1 unified layer model (docs/planning/ROADMAP-V2.md): a folder-card at ANY layer — an
// AD-5-detected block or a plain subdirectory, no visual distinction once you're inside it
// (that doc's own decision). Reuses BlockCard verbatim, not a new FolderCard — a plain
// folder's empty `pills` array already renders BlockCard's pills row as absent, which IS "no
// visual distinction," not a special case to build. `isBlock`/`fileCount` (LayerFolderItem's
// own fields) aren't part of this node's data: nothing renders them yet, and adding an unused
// field here would be exactly the speculative-data smell CLAUDE.md warns against.
export type FolderNodeData = {
  name: string;
  path: string;
  pills: string[];
  riskCount: number;
  connectionCount: number;
  dirty: boolean;
  dimmed: boolean;
  /** This folder's own inter-layer arrows (docs/planning/ROADMAP-V2.md's v2.0.1) — already
   * scoped to this one item by LayerCanvas.tsx's grouping, empty array when none. */
  arrows: LayerArrow[];
  onArrowNavigate: (targetFile: string) => void;
};

export type FolderNodeType = Node<FolderNodeData, 'folder'>;

// Identical Handle placement to BlockNode.tsx — same card height/pill-wrapping concerns,
// same fixed near-top anchor rather than RF's 50%-of-height default.
export function FolderNode({ data, selected }: NodeProps<FolderNodeType>) {
  return (
    <>
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
      <InterLayerArrows arrows={data.arrows} onNavigate={data.onArrowNavigate} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, top: 30 }} />
    </>
  );
}
