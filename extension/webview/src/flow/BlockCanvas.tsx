import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { NodeMouseHandler, EdgeMouseHandler, OnNodesChange } from '@xyflow/react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Panel, applyNodeChanges, useReactFlow, useViewport } from '@xyflow/react';
import type { Edge as CoreEdge, Risk } from '@blocknet/core';
import type { WebviewBlockNode } from '../../../src/shared/protocol.js';
import { BlockNode, type BlockNodeType } from './BlockNode.js';
import { RiskEdge, type RiskEdgeType } from './RiskEdge.js';
import { layoutBlocks, type Position } from './layout.js';
import { relatedIds, connectionCounts, siblingOffsets, type Selection } from './graph-derive.js';
import { blockAriaLabel } from './block-label.js';
import { useCameraStore } from '../camera-store.js';
import { StatusBar } from '../ui/StatusBar.js';
import { ZoomControls } from '../ui/ZoomControls.js';
import { RiskPopover } from '../ui/RiskPopover.js';
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
  nodes: WebviewBlockNode[];
  edges: CoreEdge[];
  /** Sparse, restored-from-workspaceState positions (docs/architecture/PROTOCOL.md's
   * layout/restore) — ids absent here fall through to a fresh dagre position. Defaults to
   * empty for callers (tests, the stress fixture) that don't care about persistence. */
  initialPositions?: Record<string, Position> | undefined;
  /** ROADMAP-V2.md's multi-point draggable/bendable edge routing — same sparse-override
   * contract as initialPositions, each present value an ORDERED array of zero-or-more bend
   * points (edge-path.ts). Defaults to empty for callers (tests, the stress fixture) that
   * don't care about persistence. */
  initialEdgeWaypoints?: Record<string, Position[]> | undefined;
  /** v2.0 micro view (docs/planning/ROADMAP-V2.md) — a block double-click. Optional so every
   * existing caller (tests, the dev/QA fixtures without a host round-trip wired up) keeps
   * working unchanged; GraphView.tsx is the one real caller that supplies it. */
  onBlockDoubleClick?: ((blockId: string) => void) | undefined;
};

export function BlockCanvas(props: BlockCanvasProps) {
  return (
    <ReactFlowProvider>
      <BlockCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function BlockCanvasInner({ nodes, edges, initialPositions, initialEdgeWaypoints, onBlockDoubleClick }: BlockCanvasProps) {
  const [selection, setSelection] = useState<Selection>(null);
  // Only a persistence side-channel now (debounces layout/persist to the host) — no longer
  // read to derive flowNodes' rendered position. See flowNodes' own comment for why.
  const { movePosition, edgeWaypoints, moveWaypoints } = useCameraStore(initialPositions ?? {}, initialEdgeWaypoints ?? {});
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();

  const positions = useMemo(() => layoutBlocks(nodes, edges), [nodes, edges]);
  const counts = useMemo(() => connectionCounts(nodes, edges), [nodes, edges]);
  const related = useMemo(() => relatedIds(selection, edges), [selection, edges]);
  const riskCount = useMemo(() => edges.filter((e) => e.risk).length, [edges]);

  const baseFlowNodes: BlockNodeType[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'block',
        position: initialPositions?.[n.id] ?? positions[n.id] ?? { x: 0, y: 0 },
        selected: selection?.type === 'node' && selection.id === n.id,
        ariaLabel: blockAriaLabel({ name: n.name, path: n.path, riskCount: n.riskCount, connectionCount: counts[n.id] ?? 0, dirty: n.dirty }),
        data: {
          name: n.name,
          path: n.path,
          pills: n.pills,
          riskCount: n.riskCount,
          connectionCount: counts[n.id] ?? 0,
          dirty: n.dirty,
          dimmed: related ? !related.has(n.id) : false,
        },
      })),
    [nodes, positions, counts, related, selection, initialPositions],
  );

  // React Flow's own controlled-mode drag lifecycle expects to be driven through
  // applyNodeChanges — it threads through more than position (a `dragging` flag, `measured`
  // dimensions) that RF's internal store uses to know a node is still the SAME node mid-
  // gesture. An earlier version of this file hand-rolled position patching (a fresh `.map()`
  // over every node, keyed on a locally-tracked override map) instead — it never set
  // `dragging`, and rebuilt every node's object identity on every single drag frame, not just
  // the one being dragged. Both together raced RF's own internal node-registration effect
  // under real, fast (no-devtools-throttling) pointer input: confirmed directly — with
  // devtools closed, a sustained real drag reliably hit RF's "trying to drag a node that is
  // not initialized" warning (error #015) and visibly desynced from the pointer; with devtools
  // open (slower JS execution narrowing the race window) it did not, which is exactly the
  // signature of a timing race, not a deterministic logic bug. applyNodeChanges is the
  // officially documented pattern for controlled mode precisely because it avoids this.
  const [flowNodes, setFlowNodes] = useState<BlockNodeType[]>(baseFlowNodes);
  const prevBaseFlowNodes = useRef(baseFlowNodes);

  // Re-syncs flowNodes whenever the DERIVED data actually changes (new graph, selection,
  // dimming) — not on every drag frame, since baseFlowNodes doesn't depend on live drag state
  // at all. Preserves each node's current on-screen position (which may reflect an in-session
  // drag baseFlowNodes has no way to know about) rather than snapping it back to dagre's/
  // initialPositions' value on every unrelated re-render.
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

  // Two edges between the SAME pair of nodes (either direction — a reciprocal A→B/B→A import
  // cycle is exactly this, the single most common real-world risk pattern this tool flags)
  // otherwise render as literally coincident curves — see graph-derive.ts's own comment for
  // why that's a real, live-caught interaction bug (a drag aimed at one edge silently grabbing
  // the OTHER), not just a cosmetic overlap.
  const edgeSiblingOffsets = useMemo(() => siblingOffsets(edges), [edges]);

  const flowEdges: RiskEdgeType[] = useMemo(() => {
    const mapped: RiskEdgeType[] = edges.map((e) => {
      const isRisk = !!e.risk;
      const dimmed = related ? !(related.has(e.source) && related.has(e.target)) : false;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'risk',
        selected: selection?.type === 'edge' && selection.id === e.id,
        ariaLabel: isRisk ? `${e.source} to ${e.target}, ${e.risk!.tag.toLowerCase()} risk: ${e.risk!.oneLine}` : `${e.source} to ${e.target}`,
        // ROADMAP-V2.md's multi-point draggable/bendable edge routing: `waypoints` absent/
        // empty means "no override, render the plain geometric curve" — RiskEdge.tsx's own
        // contract. `onWaypointsChange` is what makes an edge's line grabbable at all (RiskEdge
        // only renders the grab affordance/handles when this is present) — every macro AND
        // micro edge gets one (FileCanvas.tsx's own flowEdges wires the identical thing), no
        // macro-only carve-out.
        data: {
          isRisk,
          dimmed,
          ...(edgeWaypoints[e.id] !== undefined && { waypoints: edgeWaypoints[e.id] }),
          onWaypointsChange: (waypoints: Position[]) => moveWaypoints(e.id, waypoints),
          siblingOffset: edgeSiblingOffsets[e.id] ?? 0,
        },
      };
    });
    // SVG has no z-index — paint (and therefore click-hit) order is DOM order, so an edge
    // later in this array visually sits on top of, and wins clicks over, an earlier one at the
    // same point. Risk edges are exactly the ones a user most wants to click (the whole point
    // of RiskPopover), so sorting them last — a stable sort, only risk-vs-non-risk relative
    // order changes — means a risk edge crossing a non-risk one is always the one that
    // receives the click, instead of whichever happened to come first in the source data. A
    // real, reported friction on the 100-edge stress fixture: several risk edges were
    // effectively unclickable, buried under edges drawn after them.
    return [...mapped].sort((a, b) => Number(a.data?.isRisk ?? false) - Number(b.data?.isRisk ?? false));
  }, [edges, selection, related, edgeWaypoints, moveWaypoints, edgeSiblingOffsets]);

  const onNodeClick = useCallback<NodeMouseHandler>((_evt, node) => {
    setSelection((prev) => (prev?.type === 'node' && prev.id === node.id ? null : { type: 'node', id: node.id }));
  }, []);

  const onEdgeClick = useCallback<EdgeMouseHandler>((_evt, edge) => {
    setSelection((prev) => (prev?.type === 'edge' && prev.id === edge.id ? null : { type: 'edge', id: edge.id }));
  }, []);

  const onPaneClick = useCallback(() => setSelection(null), []);

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_evt, node) => {
      onBlockDoubleClick?.(node.id);
    },
    [onBlockDoubleClick],
  );

  // applyNodeChanges handles every change type (dimension measurement, selection, position,
  // add/remove) rather than filtering to 'position' only, the earlier hand-rolled version's
  // approach. That filter existed because reacting to a 'dimensions' change with a naive
  // full-array `.map()` rebuild caused an infinite render loop (a same-value-but-new-object
  // update re-triggers measurement, which fires another 'dimensions' change, forever) — worth
  // being precise about why this doesn't reintroduce that: applyNodeChanges (read directly
  // from @xyflow/react's source, not assumed) still allocates a fresh object for any node with
  // a *queued* change, dimensions included, so it isn't immune to the same loop *shape* in
  // the abstract. What actually breaks the cycle is that RF's ResizeObserver-driven
  // measurement only fires a 'dimensions' change when a node's real, observed size changes —
  // not synthetically on every unrelated render — so a settled node doesn't keep re-queuing
  // one. Confirmed empirically, not just reasoned about: BlockCanvas.test.tsx (which caught
  // the original loop via "Maximum update depth exceeded") stays green, and a sustained real
  // ~250-move Playwright drag produces no such error and no React Flow #015 warning.
  const onNodesChange = useCallback<OnNodesChange<BlockNodeType>>((changes) => {
    setFlowNodes((nds) => applyNodeChanges(changes, nds));
    for (const change of changes) {
      if (change.type === 'position' && change.position) movePosition(change.id, change.position);
    }
  }, [movePosition]);

  const onReset = useCallback(() => fitView({ ...FIT_VIEW_OPTIONS, duration: 200 }), [fitView]);

  // "Risk badge click" (TASKS-V1.md's Task 8 acceptance criteria) is satisfied by clicking
  // anywhere on a risky edge, not a second nested-interactive element on top of it — RiskEdge's
  // "!" badge is already reachable via the same onEdgeClick/selection path BlockCard's
  // `interactive` prop exists to avoid duplicating (see its own comment): a separately
  // clickable/focusable badge nested inside an already-interactive edge would be the identical
  // nested-interactive-element anti-pattern, just on an edge instead of a card.
  const selectedRisk: Risk | undefined = useMemo(() => {
    if (selection?.type !== 'edge') return undefined;
    return edges.find((e) => e.id === selection.id)?.risk;
  }, [selection, edges]);

  return (
    <div className="bn-canvas-root">
      <ReactFlow<BlockNodeType, RiskEdgeType>
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
        // v2.0 micro view (docs/planning/ROADMAP-V2.md): a block double-click now dives into
        // its file-level graph — React Flow's own zoomOnDoubleClick default (true) must be off,
        // not just "also true," or it wins the same gesture. d3-zoom's dblclicked handler calls
        // event.stopImmediatePropagation() before onNodeDoubleClick's bubbled synthetic event
        // ever reaches React's root listener, so with the default left on, double-clicking a
        // block silently zoomed the canvas and onBlockDoubleClick never fired at all — a real
        // bug live Playwright verification against the real dev server caught (a double-click
        // on a real node in a real browser exercises d3-zoom's actual attached listener; jsdom-
        // based unit tests using fireEvent.doubleClick never do, which is exactly why this
        // shipped past every unit test green and needed real-browser verification to surface —
        // confirmed by reading d3-zoom's own noevent() helper, not just inferred from symptoms).
        zoomOnDoubleClick={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="var(--bn-grid-dot)" bgColor="var(--bn-canvas-bg)" />
        <Panel position="bottom-left">
          <ZoomControls zoomPercent={Math.round(zoom * 100)} onZoomIn={() => zoomIn({ duration: 150 })} onZoomOut={() => zoomOut({ duration: 150 })} onReset={onReset} />
        </Panel>
      </ReactFlow>
      {selectedRisk && <RiskPopover risk={selectedRisk} onClose={() => setSelection(null)} />}
      <StatusBar riskCount={riskCount} />
    </div>
  );
}
