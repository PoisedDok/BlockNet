// Resolves repo-wide FileEdge[] against one layer's item boundaries (docs/planning/
// ROADMAP-V2.md's v2.0.1 "unified layer model"). This is the ONE generalized operation behind
// both intra-layer edges and inter-layer arrows — see that doc's "Engine implications,
// generalized" for why a third bespoke aggregator was deliberately not written instead: both
// classifications fall out of the same "which item does each endpoint resolve to at this
// layer" question, split only by whether both sides resolved or just one did.
//
// Supersedes edges/block-aggregate.ts's aggregateToBlockEdges() and analyze-micro.ts's
// aggregateFileEdges() for any layer that mixes folder-aggregate and file-leaf items — those
// two functions each only handle one item kind (block-only, file-only respectively) and are
// kept only for their still-valid narrower callers, not duplicated here.
import type { FileEdge, LayerArrow, LayerEdge, LayerItemBoundary } from '../types.js';

// NUL-joined, not `->`-joined: a real path can legally contain the substring "->"
// (edges/block-aggregate.ts's own aggregationKey comment already established why this
// matters), so the internal Map key must stay collision-free independent of path content.
function pairKey(a: string, b: string): string {
  return `${a}\0${b}`;
}

function resolveToItem(filePath: string, items: LayerItemBoundary[]): LayerItemBoundary | undefined {
  return items.find((item) =>
    item.isFolder ? filePath === item.path || filePath.startsWith(`${item.path}/`) : filePath === item.path,
  );
}

// `layerPath` is the folder currently being viewed ('' for repo root / layer 0); `items` are
// its direct children, one depth level below `layerPath`. Direction for an inter-layer arrow
// compares the off-screen file's own path-segment count against THAT depth (`items`' depth,
// not `layerPath`'s own) — see ROADMAP-V2.md's "Inter-layer direction, precise rule": a
// directional hint based on relative depth, not a claim of direct reachability.
//
// `riskyPairs` is the set of raw (sourceFile, targetFile) pairs known to participate in a real
// import cycle, NUL-joined (pairKey format, matching this file's own internal key convention) —
// the caller's job to compute (analyze-layer.ts, from findCyclicFileEdges()), not this
// function's, keeping this module free of any cache/risk-computation dependency. An aggregated
// edge/arrow is risky if ANY raw pair folded into it is risky — OR-accumulated across every
// contributing pair, never just the first one seen, since a later-seen risky pair must still
// flip an already-created non-risky entry.
export function resolveLayerConnections(
  fileEdges: FileEdge[],
  items: LayerItemBoundary[],
  layerPath: string,
  riskyPairs: Set<string> = new Set(),
): { edges: LayerEdge[]; arrows: LayerArrow[] } {
  const layerDepth = layerPath === '' ? 0 : layerPath.split('/').length;
  const itemDepth = layerDepth + 1;

  const edges = new Map<string, LayerEdge>();
  const arrows = new Map<string, LayerArrow>();

  for (const fileEdge of fileEdges) {
    if (fileEdge.sourceFile === fileEdge.targetFile) continue;
    const isRisky = riskyPairs.has(pairKey(fileEdge.sourceFile, fileEdge.targetFile));

    const sourceItem = resolveToItem(fileEdge.sourceFile, items);
    const targetItem = resolveToItem(fileEdge.targetFile, items);

    if (!sourceItem && !targetItem) continue; // irrelevant to this layer entirely

    if (sourceItem && targetItem) {
      if (sourceItem.id === targetItem.id) continue; // hidden inside one item's own subtree
      const key = pairKey(sourceItem.id, targetItem.id);
      const existing = edges.get(key);
      if (existing) {
        if (isRisky) existing.risk = true;
      } else {
        edges.set(key, { id: `${sourceItem.id}->${targetItem.id}`, source: sourceItem.id, target: targetItem.id, risk: isRisky });
      }
      continue;
    }

    const visibleItem = (sourceItem ?? targetItem) as LayerItemBoundary;
    const offScreenFile = sourceItem ? fileEdge.targetFile : fileEdge.sourceFile;
    const offScreenDepth = offScreenFile.split('/').length;
    const direction: 'up' | 'down' = offScreenDepth > itemDepth ? 'down' : 'up';

    const key = pairKey(visibleItem.id, offScreenFile);
    const existingArrow = arrows.get(key);
    if (existingArrow) {
      if (isRisky) existingArrow.risk = true;
    } else {
      arrows.set(key, {
        id: `${visibleItem.id}->${offScreenFile}`,
        sourceItemId: visibleItem.id,
        targetFile: offScreenFile,
        direction,
        risk: isRisky,
      });
    }
  }

  return { edges: [...edges.values()], arrows: [...arrows.values()] };
}
