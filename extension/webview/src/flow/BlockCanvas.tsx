import { useMemo, useState, useCallback } from 'react';
import type { NodeMouseHandler, EdgeMouseHandler, OnNodesChange, NodePositionChange } from '@xyflow/react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Panel, useReactFlow, useViewport } from '@xyflow/react';
import type { BlockNode as CoreBlockNode, Edge as CoreEdge } from '@blocknet/core';
import { BlockNode, type BlockNodeType } from './BlockNode.js';
import { RiskEdge, type RiskEdgeType } from './RiskEdge.js';
import { layoutBlocks, type Position } from './layout.js';
import { relatedIds, connectionCounts, type Selection } from './graph-derive.js';
import { blockAriaLabel } from './block-label.js';
import { StatusBar } from '../ui/StatusBar.js';
import { ZoomControls } from '../ui/ZoomControls.js';
import '@xyflow/react/dist/style.css';
import './BlockCanvas.css';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.4;
// dagre's raw output isn't centered around (0,0) — its coordinates depend on graph shape, so
// a fixed defaultViewport left blocks rendering off-screen for any graph whose layout didn't
// happen to start near the origin (confirmed visually: two nodes were cut off above the
// viewport's top edge). fitView computes the viewport from the actual node bounds instead.
const FIT_VIEW_OPTIONS = { padding: 0.15, duration: 0 };

const nodeTypes = { block: BlockNode };
const edgeTypes = { risk: RiskEdge };

export type BlockCanvasProps = {
  nodes: CoreBlockNode[];
  edges: CoreEdge[];
};

export function BlockCanvas(props: BlockCanvasProps) {
  return (
    <ReactFlowProvider>
      <BlockCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function BlockCanvasInner({ nodes, edges }: BlockCanvasProps) {
  const [selection, setSelection] = useState<Selection>(null);
  // React Flow runs in controlled mode (nodes/edges are recomputed from props via useMemo
  // below, not RF's own defaultNodes/defaultEdges) — without onNodesChange committing drag
  // (and keyboard-arrow) position changes back into state here, RF computes the moved
  // position internally and then silently discards it on the very next render, since
  // `hasDefaultNodes` (the flag that makes RF self-manage position) is only set when a
  // defaultNodes prop is supplied. Confirmed as a real, silent bug by two-pass review — see
  // BlockCanvas.test.tsx's regression test. Dagre's own layout output is untouched; this only
  // overrides positions for nodes a user has actually moved this session.
  const [dragOverrides, setDragOverrides] = useState<Record<string, Position>>({});
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();

  const positions = useMemo(() => layoutBlocks(nodes, edges), [nodes, edges]);
  const counts = useMemo(() => connectionCounts(nodes, edges), [nodes, edges]);
  const related = useMemo(() => relatedIds(selection, edges), [selection, edges]);
  const riskCount = useMemo(() => edges.filter((e) => e.risk).length, [edges]);

  const flowNodes: BlockNodeType[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'block',
        position: dragOverrides[n.id] ?? positions[n.id] ?? { x: 0, y: 0 },
        selected: selection?.type === 'node' && selection.id === n.id,
        ariaLabel: blockAriaLabel({ name: n.name, path: n.path, riskCount: n.riskCount, connectionCount: counts[n.id] ?? 0 }),
        data: {
          name: n.name,
          path: n.path,
          pills: n.pills,
          riskCount: n.riskCount,
          connectionCount: counts[n.id] ?? 0,
          dimmed: related ? !related.has(n.id) : false,
        },
      })),
    [nodes, positions, dragOverrides, counts, related, selection],
  );

  const flowEdges: RiskEdgeType[] = useMemo(
    () =>
      edges.map((e) => {
        const isRisk = !!e.risk;
        const dimmed = related ? !(related.has(e.source) && related.has(e.target)) : false;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'risk',
          selected: selection?.type === 'edge' && selection.id === e.id,
          ariaLabel: isRisk ? `${e.source} to ${e.target}, ${e.risk!.tag.toLowerCase()} risk: ${e.risk!.oneLine}` : `${e.source} to ${e.target}`,
          data: { isRisk, dimmed },
        };
      }),
    [edges, selection, related],
  );

  const onNodeClick = useCallback<NodeMouseHandler>((_evt, node) => {
    setSelection((prev) => (prev?.type === 'node' && prev.id === node.id ? null : { type: 'node', id: node.id }));
  }, []);

  const onEdgeClick = useCallback<EdgeMouseHandler>((_evt, edge) => {
    setSelection((prev) => (prev?.type === 'edge' && prev.id === edge.id ? null : { type: 'edge', id: edge.id }));
  }, []);

  const onPaneClick = useCallback(() => setSelection(null), []);

  // onNodesChange fires for far more than drags/arrow-key moves (dimension measurement,
  // selection, add/remove) — reacting to anything beyond an actual 'position' change with a
  // real position payload caused an infinite render loop in testing: a same-value-but-new-
  // object state update on every 'dimensions' change re-triggers measurement, which fires
  // another 'dimensions' change, forever. Filtered to exactly what a drag/arrow-move sends.
  const onNodesChange = useCallback<OnNodesChange<BlockNodeType>>((changes) => {
    const moves = changes.filter((c): c is NodePositionChange => c.type === 'position' && !!c.position);
    if (moves.length === 0) return;
    setDragOverrides((prev) => {
      const next = { ...prev };
      for (const c of moves) next[c.id] = c.position!;
      return next;
    });
  }, []);

  const onReset = useCallback(() => fitView({ ...FIT_VIEW_OPTIONS, duration: 200 }), [fitView]);

  return (
    <div className="bn-canvas-root">
      <ReactFlow<BlockNodeType, RiskEdgeType>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        proOptions={{ hideAttribution: true }}
        selectionOnDrag={false}
        panOnDrag
        nodesConnectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="var(--bn-grid-dot)" bgColor="var(--bn-canvas-bg)" />
        <Panel position="bottom-left">
          <ZoomControls zoomPercent={Math.round(zoom * 100)} onZoomIn={() => zoomIn({ duration: 150 })} onZoomOut={() => zoomOut({ duration: 150 })} onReset={onReset} />
        </Panel>
      </ReactFlow>
      <StatusBar riskCount={riskCount} />
    </div>
  );
}
