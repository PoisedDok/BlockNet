import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeMouseHandler, EdgeMouseHandler, OnNodesChange } from '@xyflow/react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Panel, applyNodeChanges, useReactFlow, useViewport } from '@xyflow/react';
import type { MicroFileEdge } from '@blocknet/core';
import type { WebviewMicroFileNode } from '../../../src/shared/protocol.js';
import { FileNode, type FileNodeType } from './FileNode.js';
import { RiskEdge, type RiskEdgeType } from './RiskEdge.js';
import { layoutFiles } from './file-layout.js';
import type { Position } from './layout.js';
import { relatedIds, siblingOffsets, type Selection } from './graph-derive.js';
import { postToHost } from '../host-bridge.js';
import { StatusBar } from '../ui/StatusBar.js';
import { ZoomControls } from '../ui/ZoomControls.js';
import '@xyflow/react/dist/style.css';
import './FileCanvas.css';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.4;
const FIT_VIEW_OPTIONS = { padding: 0.18, duration: 0 };

const nodeTypes = { file: FileNode };
const edgeTypes = { risk: RiskEdge };

export type FileCanvasProps = {
  blockId: string;
  blockName: string;
  files: WebviewMicroFileNode[];
  edges: MicroFileEdge[];
  onBack: () => void;
  /** File-level drag parity (docs/planning/ROADMAP-V2.md) — same sparse-override contract as
   * BlockCanvas.tsx's initialPositions, but keyed by file id and sourced from GraphView.tsx's
   * OWN camera-store instance (survives this component's own per-dive remount — see
   * GraphView.tsx's own comment for why that ownership boundary matters here). Defaults to
   * empty for callers (tests, the dev/QA fixture bypass) that don't care about persistence. */
  initialPositions?: Record<string, Position> | undefined;
  /** ROADMAP-V2.md's multi-point draggable/bendable edge routing — each present value an
   * ORDERED array of zero-or-more bend points (edge-path.ts), same as BlockCanvas.tsx's own. */
  initialEdgeWaypoints?: Record<string, Position[]> | undefined;
  /** Present only when a real host round-trip can persist a drag (GraphView.tsx's real,
   * non-fixture call site). Absent in tests/fixtures that don't wire persistence — nodes stay
   * draggable either way (drag is a local interaction independent of whether it's saved), but
   * no waypoint handle/grab affordance renders without onWaypointsChange, matching
   * RiskEdge.tsx's own contract. */
  onPositionChange?: ((fileId: string, position: Position) => void) | undefined;
  onWaypointsChange?: ((edgeId: string, waypoints: Position[]) => void) | undefined;
};

/** File-level canvas for a single block's dive-in (docs/planning/ROADMAP-V2.md's v2.0 micro
 * view) — a second, independent ReactFlow instance mirroring BlockCanvas.tsx's structure at
 * file granularity: its own pan/zoom/selection/dimming, no shared state with the macro canvas
 * (GraphView.tsx cross-fades between the two, never swaps one graph's data into the other's
 * instance). No risk popover: MicroFileEdge only carries a boolean `risk` flag, not a full
 * Risk object with oneLine/explain/fix/evidence (analyze-micro.ts's own header comment — the
 * macro graph is where a crossing risk's full explanation already lives; this view answers
 * "which files/imports are involved," not "why," a deliberately narrower first cut). */
export function FileCanvas(props: FileCanvasProps) {
  return (
    <ReactFlowProvider>
      <FileCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function FileCanvasInner({ blockId, blockName, files, edges, onBack, initialPositions, initialEdgeWaypoints, onPositionChange, onWaypointsChange }: FileCanvasProps) {
  const [selection, setSelection] = useState<Selection>(null);
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();

  const positions = useMemo(() => layoutFiles(files, edges), [files, edges]);
  const related = useMemo(() => relatedIds(selection, edges), [selection, edges]);
  const riskyFileCount = useMemo(() => files.filter((f) => f.risk).length, [files]);

  const openInEditor = useCallback((fileId: string) => {
    postToHost({ type: 'open/file', fileId });
  }, []);

  // `initialPositions` is captured ONCE, at mount, via useState's lazy initializer — never
  // updated again for the lifetime of this component instance, deliberately. Unlike
  // BlockCanvas.tsx, where the equivalent prop is a session-stable value from App.tsx's own
  // layout/restore-only state (never touched again once a session starts), GraphView.tsx
  // feeds THIS component's initialPositions from its own live camera-store instance, which it
  // updates on every single onPositionChange call — i.e. every drag FRAME, not just at drag
  // end (mirroring how BlockCanvas's own onNodesChange already calls movePosition on every
  // frame too; the difference is BlockCanvas's returned `positions` is never fed back into ITS
  // baseFlowNodes, staying a pure persistence side-channel, per that file's own comment). Had
  // baseFlowNodes below stayed reactive to the live `initialPositions` prop, every drag frame
  // would recompute it with a fresh object identity, which the reconciliation effect further
  // down would treat as "the derived graph changed" and re-run `setFlowNodes` on top of React
  // Flow's OWN in-flight internal drag tracking — a real, live-reproduced bug (not
  // hypothetical): confirmed via Playwright as React Flow's error #015 ("trying to drag a node
  // that is not initialized") firing repeatedly with visible flicker during an ordinary
  // file-card drag, then confirmed fixed (RED against the reactive version, GREEN after).
  // Since FileCanvas always fully remounts on a fresh dive (GraphView.tsx's `key={activeBlock.
  // id}`, or a full unmount/remount even for a same-block re-dive per handleBack's delayed
  // teardown), a mount-time-only capture already IS "whatever GraphView's camera store last
  // knew" for every dive that matters — exactly the "seed a newly-appeared node's position,
  // never fight an in-progress drag" contract BlockCanvas's own design already established.
  // A plain useState (not a ref) is deliberate too, not just a style choice: reading a ref's
  // `.current` inside a useMemo factory runs during render, which react-hooks/refs correctly
  // flags as unsafe in the general case (a ref mutated between renders could be read
  // inconsistently under concurrent rendering) — state read during render has no such hazard.
  const [seedPositions] = useState(initialPositions);

  const baseFlowNodes: FileNodeType[] = useMemo(
    () =>
      files.map((f) => ({
        id: f.id,
        type: 'file',
        position: seedPositions?.[f.id] ?? positions[f.id] ?? { x: 0, y: 0 },
        selected: selection?.type === 'node' && selection.id === f.id,
        data: {
          name: f.name,
          path: f.path,
          loc: f.loc,
          dirty: f.dirty,
          risk: f.risk,
          dimmed: related ? !related.has(f.id) : false,
          onOpenInEditor: () => openInEditor(f.id),
        },
      })),
    [files, positions, selection, related, openInEditor, seedPositions],
  );

  // Same controlled-mode drag lifecycle as BlockCanvas.tsx's own flowNodes/onNodesChange dance
  // — see that file's comment for the exact React Flow race (#015, "trying to drag a node that
  // is not initialized") this pattern avoids. Identical reasoning applies here: same library,
  // same controlled-mode setup, just a different node type.
  const [flowNodes, setFlowNodes] = useState<FileNodeType[]>(baseFlowNodes);
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

  // Unlike `initialPositions` above, `initialEdgeWaypoints` is read DIRECTLY and reactively —
  // no seeded useState, no mount-time-only snapshot — and that asymmetry is intentional, not an
  // oversight. RF error #015 (the reason initialPositions is frozen at mount) is specifically a
  // React-Flow-controlled-NODE drag race: RF tracks its own internal per-node drag state, and a
  // node prop changing identity mid-drag fights that internal state. Waypoint dragging has no
  // such internal RF state to fight — RiskEdge.tsx's whole gesture (basePoints/liveWaypoints/
  // emit, see that file) is manual refs + pointer capture via EdgeLabelRenderer, entirely
  // outside RF's controlled-node machinery. And every mutation to `edgeWaypoints`/
  // `fileEdgeWaypoints` in GraphView's camera store originates from THIS component's own
  // `emit()` call, so a later prop-driven resync only ever reaffirms the same value the
  // gesture already wrote — never a stale one racing an in-progress drag.
  // Same reciprocal-edge separation as BlockCanvas.tsx — see graph-derive.ts's own comment.
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
    // Same risk-edges-drawn-last rule as BlockCanvas.tsx (SVG has no z-index — DOM order
    // decides both paint and click-hit order).
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

  const onNodesChange = useCallback<OnNodesChange<FileNodeType>>(
    (changes) => {
      setFlowNodes((nds) => applyNodeChanges(changes, nds));
      for (const change of changes) {
        if (change.type === 'position' && change.position) onPositionChange?.(change.id, change.position);
      }
    },
    [onPositionChange],
  );

  return (
    <div className="bn-canvas-root" data-block-id={blockId}>
      <ReactFlow<FileNodeType, RiskEdgeType>
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
      <button type="button" className="bn-micro-back" onClick={onBack}>
        ← zoom out to map
      </button>
      <StatusBar riskCount={riskyFileCount} breadcrumb={{ blockName, onBack }} />
    </div>
  );
}
