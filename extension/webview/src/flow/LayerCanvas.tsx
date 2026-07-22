import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeMouseHandler, EdgeMouseHandler, OnNodesChange } from '@xyflow/react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Panel, applyNodeChanges, useReactFlow, useViewport } from '@xyflow/react';
import type { LayerArrow, LayerEdge } from '@blocknet/core';
import type { Position, WebviewLayerItem } from '../../../src/shared/protocol.js';
import { FileNode, type FileNodeType } from './FileNode.js';
import { FolderNode, type FolderNodeType } from './FolderNode.js';
import { DocStackNode, type DocStackNodeType } from './DocStackNode.js';
import { RiskEdge, type RiskEdgeType } from './RiskEdge.js';
import { layoutLayerItems } from './layer-layout.js';
import { relatedIds, connectionCounts, siblingOffsets, type Selection } from './graph-derive.js';
import { blockAriaLabel } from './block-label.js';
import { postToHost } from '../host-bridge.js';
import { StatusBar } from '../ui/StatusBar.js';
import { ZoomControls } from '../ui/ZoomControls.js';
import { DocStackPopover } from '../ui/DocStackPopover.js';
import '@xyflow/react/dist/style.css';
import './LayerCanvas.css';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.4;
const FIT_VIEW_OPTIONS = { padding: 0.15, duration: 0 };

const nodeTypes = { file: FileNode, folder: FolderNode, docstack: DocStackNode };
const edgeTypes = { risk: RiskEdge };

type LayerNodeType = FileNodeType | FolderNodeType | DocStackNodeType;

// Stable, module-level defaults — NOT default parameter values (`arrows = []`). A default
// parameter evaluates its expression fresh on every call where the prop is omitted, handing
// baseFlowNodes' useMemo a NEW array/function identity every single render; that fresh identity
// changes arrowsByItem, which changes baseFlowNodes, which the reconciliation effect below
// treats as "the derived graph changed" and calls setFlowNodes — triggering a re-render that
// hits the exact same fresh-default path again. A real, live "Maximum update depth exceeded"
// crash caught by this component's own test suite, not a hypothetical — the same defect class
// BlockCanvas.tsx's own history already named for an unrelated cause (a naive per-render
// rebuild reacting to its own dimension-measurement change).
const NO_ARROWS: LayerArrow[] = [];
function noopArrowNavigate() {}

export type LayerCanvasProps = {
  layerPath: string;
  items: WebviewLayerItem[];
  edges: LayerEdge[];
  /** Inter-layer connections (docs/planning/ROADMAP-V2.md's v2.0.1) — grouped by sourceItemId
   * below and attached to each item's own node data; defaults to empty so every existing caller
   * (tests, fixtures without arrow data) keeps working unchanged. */
  arrows?: LayerArrow[] | undefined;
  /** A folder-item double-click dives one layer deeper (docs/planning/ROADMAP-V2.md's v2.0.1
   * unified layer model) — the identical interaction BlockCanvas.tsx's onBlockDoubleClick
   * already established for macro blocks, now generalized to any folder-card at any depth. */
  onDive: (itemId: string) => void;
  /** Clicking an inter-layer arrow (docs/planning/ROADMAP-V2.md's v2.0.1) — navigates to the
   * off-screen target file's own layer. A no-op default so every existing caller that doesn't
   * wire real navigation keeps working unchanged. */
  onArrowNavigate?: ((targetFile: string) => void) | undefined;
  initialPositions?: Record<string, Position> | undefined;
  initialEdgeWaypoints?: Record<string, Position[]> | undefined;
  onPositionChange?: ((itemId: string, position: Position) => void) | undefined;
  onWaypointsChange?: ((edgeId: string, waypoints: Position[]) => void) | undefined;
};

/** One layer's canvas — repo root (layer 0) down through arbitrary directory depth
 * (docs/planning/ROADMAP-V2.md's v2.0.1 unified layer model). Supersedes BlockCanvas.tsx
 * (macro-only) and FileCanvas.tsx (file-leaves-only): every layer mixes folder-aggregate items
 * and file-leaf items, so there is exactly one canvas shape now, not two. Built by merging
 * FileCanvas.tsx's proven drag/reconciliation machinery (kept structurally unchanged — only
 * the node-construction step below branches on item kind) with BlockCanvas.tsx's
 * double-click-to-dive handling (`onNodeDoubleClick` + `zoomOnDoubleClick={false}`, including
 * the same d3-zoom stopImmediatePropagation gotcha that pattern already accounts for). No
 * RiskPopover here — LayerEdge carries only a boolean `risk` flag (mirroring MicroFileEdge's
 * own deliberately-narrower shape), not a full Risk object; v2.1's Connection Inspector is
 * where a richer per-edge explanation lands. */
export function LayerCanvas(props: LayerCanvasProps) {
  return (
    <ReactFlowProvider>
      <LayerCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function LayerCanvasInner({
  layerPath,
  items,
  edges,
  arrows = NO_ARROWS,
  onDive,
  onArrowNavigate = noopArrowNavigate,
  initialPositions,
  initialEdgeWaypoints,
  onPositionChange,
  onWaypointsChange,
}: LayerCanvasProps) {
  const [selection, setSelection] = useState<Selection>(null);
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();

  const positions = useMemo(() => layoutLayerItems(items, edges), [items, edges]);
  const counts = useMemo(() => connectionCounts(items, edges), [items, edges]);
  const related = useMemo(() => relatedIds(selection, edges), [selection, edges]);
  // A doc-stack never contributes to the risk count — doc files never participate in import
  // cycles or boundary violations (core/src/analyze-layer.ts's own reasoning).
  const riskyCount = useMemo(
    () => items.filter((i) => (i.kind === 'file' ? i.risk : i.kind === 'folder' ? i.riskCount > 0 : false)).length,
    [items],
  );

  // Grouped once per arrows change, not recomputed inline per-node in baseFlowNodes below —
  // arrows already carry their own sourceItemId (core's resolveLayerConnections()), this is
  // purely a lookup convenience, not new aggregation logic.
  const arrowsByItem = useMemo(() => {
    const map = new Map<string, LayerArrow[]>();
    for (const arrow of arrows) {
      const existing = map.get(arrow.sourceItemId);
      if (existing) existing.push(arrow);
      else map.set(arrow.sourceItemId, [arrow]);
    }
    return map;
  }, [arrows]);

  const openInEditor = useCallback((fileId: string) => {
    postToHost({ type: 'open/file', fileId });
  }, []);

  // Mount-time-only capture, same reasoning as FileCanvas.tsx's own seedPositions (RF error
  // #015 — see that file's comment for the full account of the live-reproduced flicker bug
  // this avoids). This component remounts fresh on every layer navigation (GraphView.tsx's
  // `key={layerPath}`), so a mount-time snapshot already is "whatever the camera store last
  // knew" for every navigation that matters.
  const [seedPositions] = useState(initialPositions);

  const baseFlowNodes: LayerNodeType[] = useMemo(
    () =>
      items.map((item): LayerNodeType => {
        const position = seedPositions?.[item.id] ?? positions[item.id] ?? { x: 0, y: 0 };
        const selected = selection?.type === 'node' && selection.id === item.id;
        const dimmed = related ? !related.has(item.id) : false;

        const itemArrows = arrowsByItem.get(item.id) ?? [];

        if (item.kind === 'file') {
          return {
            id: item.id,
            type: 'file',
            position,
            selected,
            data: {
              name: item.name,
              path: item.path,
              loc: item.loc,
              dirty: item.dirty,
              risk: item.risk,
              dimmed,
              onOpenInEditor: () => openInEditor(item.id),
              arrows: itemArrows,
              onArrowNavigate,
            },
          };
        }
        if (item.kind === 'docstack') {
          // Never carries arrows (doc files never appear in FileEdge[], core/src/
          // analyze-layer.ts's own reasoning) and never dives — clicking it selects it, which
          // triggers the DocStackPopover below instead.
          return {
            id: item.id,
            type: 'docstack',
            position,
            selected,
            data: { files: item.files, dimmed },
          };
        }
        return {
          id: item.id,
          type: 'folder',
          position,
          selected,
          ariaLabel: blockAriaLabel({ name: item.name, path: item.path, riskCount: item.riskCount, connectionCount: counts[item.id] ?? 0, dirty: item.dirty }),
          data: {
            name: item.name,
            path: item.path,
            pills: item.pills,
            riskCount: item.riskCount,
            connectionCount: counts[item.id] ?? 0,
            dirty: item.dirty,
            dimmed,
            arrows: itemArrows,
            onArrowNavigate,
          },
        };
      }),
    [items, positions, counts, selection, related, openInEditor, seedPositions, arrowsByItem, onArrowNavigate],
  );

  // Identical controlled-mode drag lifecycle as FileCanvas.tsx/BlockCanvas.tsx — see either
  // file's own comment for the exact React Flow race (#015) this avoids. Kept byte-identical
  // in shape deliberately: this is proven, live-bug-fixed code, not something to re-derive.
  const [flowNodes, setFlowNodes] = useState<LayerNodeType[]>(baseFlowNodes);
  const prevBaseFlowNodes = useRef(baseFlowNodes);

  useEffect(() => {
    if (prevBaseFlowNodes.current === baseFlowNodes) return;
    prevBaseFlowNodes.current = baseFlowNodes;
    setFlowNodes((prevFlowNodes) => {
      const prevById = new Map(prevFlowNodes.map((n) => [n.id, n]));
      return baseFlowNodes.map((n) => {
        const prev = prevById.get(n.id);
        return prev ? { ...n, position: prev.position } : n;
      });
    });
  }, [baseFlowNodes]);

  const edgeSiblingOffsets = useMemo(() => siblingOffsets(edges), [edges]);

  const flowEdges: RiskEdgeType[] = useMemo(() => {
    const mapped: RiskEdgeType[] = edges.map((e) => {
      const dimmed = related ? !(related.has(e.source) && related.has(e.target)) : false;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'risk',
        selected: selection?.type === 'edge' && selection.id === e.id,
        ariaLabel: e.risk ? `${e.source} to ${e.target}, part of a circular import` : `${e.source} to ${e.target}`,
        data: {
          isRisk: e.risk,
          dimmed,
          ...(initialEdgeWaypoints?.[e.id] !== undefined && { waypoints: initialEdgeWaypoints[e.id] }),
          ...(onWaypointsChange && { onWaypointsChange: (waypoints: Position[]) => onWaypointsChange(e.id, waypoints) }),
          siblingOffset: edgeSiblingOffsets[e.id] ?? 0,
        },
      };
    });
    return [...mapped].sort((a, b) => Number(a.data?.isRisk ?? false) - Number(b.data?.isRisk ?? false));
  }, [edges, selection, related, initialEdgeWaypoints, onWaypointsChange, edgeSiblingOffsets]);

  const onNodeClick = useCallback<NodeMouseHandler>((_evt, node) => {
    setSelection((prev) => (prev?.type === 'node' && prev.id === node.id ? null : { type: 'node', id: node.id }));
  }, []);

  const onEdgeClick = useCallback<EdgeMouseHandler>((_evt, edge) => {
    setSelection((prev) => (prev?.type === 'edge' && prev.id === edge.id ? null : { type: 'edge', id: edge.id }));
  }, []);

  const onPaneClick = useCallback(() => setSelection(null), []);
  const onReset = useCallback(() => fitView({ ...FIT_VIEW_OPTIONS, duration: 200 }), [fitView]);

  // Only a folder-typed node dives — a file-leaf has nothing beneath it to show. Mirrors
  // BlockCanvas.tsx's onNodeDoubleClick + the same zoomOnDoubleClick={false} requirement (RF's
  // own zoomOnDoubleClick default wins the gesture via d3-zoom's stopImmediatePropagation
  // before onNodeDoubleClick's bubbled synthetic event reaches React's root listener — a real,
  // live-Playwright-caught bug on the macro canvas, the same fix applies here unchanged).
  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_evt, node) => {
      const item = items.find((i) => i.id === node.id);
      if (item?.kind === 'folder') onDive(item.id);
    },
    [items, onDive],
  );

  const onNodesChange = useCallback<OnNodesChange<LayerNodeType>>(
    (changes) => {
      setFlowNodes((nds) => applyNodeChanges(changes, nds));
      for (const change of changes) {
        if (change.type === 'position' && change.position) onPositionChange?.(change.id, change.position);
      }
    },
    [onPositionChange],
  );

  // Selecting a doc-stack card shows its popover (DocStackPopover.tsx) — the same
  // select-then-show pattern BlockCanvas.tsx's retired selectedRisk used for RiskPopover.
  // Closing it clears the selection so re-clicking the same card reopens it (matching
  // onNodeClick's own toggle-off-on-reselect behavior).
  const selectedDocStack = useMemo(() => {
    if (selection?.type !== 'node') return undefined;
    const item = items.find((i) => i.id === selection.id);
    return item?.kind === 'docstack' ? item : undefined;
  }, [selection, items]);

  return (
    <div className="bn-canvas-root" data-layer-path={layerPath}>
      <ReactFlow<LayerNodeType, RiskEdgeType>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
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
        zoomOnDoubleClick={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="var(--bn-grid-dot)" bgColor="var(--bn-canvas-bg)" />
        <Panel position="bottom-left">
          <ZoomControls zoomPercent={Math.round(zoom * 100)} onZoomIn={() => zoomIn({ duration: 150 })} onZoomOut={() => zoomOut({ duration: 150 })} onReset={onReset} />
        </Panel>
      </ReactFlow>
      {selectedDocStack && <DocStackPopover files={selectedDocStack.files} onClose={() => setSelection(null)} />}
      {/* No breadcrumb here — GraphView.tsx's FloorPicker (docs/planning/ROADMAP-V2.md's
          v2.0.1 layer-stack navigator) owns ALL navigation display now, docked top-left,
          spanning the whole session rather than one canvas instance. */}
      <StatusBar riskCount={riskyCount} />
    </div>
  );
}
