import type { LayerArrow, LayerEdge } from '@blocknet/core';
import type { WebviewLayerItem } from '../../../src/shared/protocol.js';
import type { LayerPayload } from '../flow/GraphView.js';

// Synthetic 30-block/100-edge fixture — Task 7's stated scale target for pan/zoom/drag/select
// smoothness (docs/planning/TASKS-V1.md), generalized to the v2.0.1 unified layer model
// (docs/planning/ROADMAP-V2.md). Generated, not hand-authored: real repos this size have too
// many blocks to name individually, and what matters for this fixture is count and
// connectivity shape, not realistic names.

const BLOCK_COUNT = 30;
const EDGE_COUNT = 100;

const emptyArrows: LayerArrow[] = [];

const items: WebviewLayerItem[] = Array.from({ length: BLOCK_COUNT }, (_, i) => ({
  kind: 'folder',
  id: `block-${i}`,
  name: `block-${i}`,
  path: `packages/block-${i}`,
  isBlock: true,
  pills: i % 3 === 0 ? ['typescript', 'react'] : ['typescript'],
  fileCount: (i % 9) + 1,
  riskCount: i % 7 === 0 ? 1 : 0,
  dirty: i % 5 === 0,
}));

const edges: LayerEdge[] = Array.from({ length: EDGE_COUNT }, (_, i) => {
  const source = i % BLOCK_COUNT;
  const target = (i * 7 + 3) % BLOCK_COUNT;
  return {
    id: `edge-${i}`,
    source: `block-${source}`,
    target: `block-${target}`,
    risk: i % 7 === 0 && source !== target,
  };
}).filter((e) => e.source !== e.target);

// Only block-0 has data one layer deeper; diving into any other block exercises the
// graph/layer/error fallback path (GraphView.tsx falls back to the previous layer with an
// inline banner), which the sample fixture's fully-populated dataset never reaches. Full
// per-block-of-30 layer-1 fixtures aren't built here: a folder layer at stress scale is its
// own, separately-tracked perf question (ROADMAP-V2.md's own "micro multiplies node count
// 10-100x and needs its own perf work" note), not something this fixture needs to answer to
// verify the cross-fade/loading/error mechanics themselves.
export const stressLayers: Record<string, LayerPayload> = {
  '': { layerPath: '', items, edges, arrows: emptyArrows },
  'block-0': {
    layerPath: 'block-0',
    items: [
      { kind: 'file', id: 'packages/block-0/src/index.ts', name: 'index.ts', path: 'packages/block-0/src/index.ts', loc: 14, dirty: true, risk: false },
      { kind: 'file', id: 'packages/block-0/src/util.ts', name: 'util.ts', path: 'packages/block-0/src/util.ts', loc: 22, dirty: false, risk: false },
    ],
    edges: [
      {
        id: 'packages/block-0/src/index.ts->packages/block-0/src/util.ts',
        source: 'packages/block-0/src/index.ts',
        target: 'packages/block-0/src/util.ts',
        risk: false,
      },
    ],
    arrows: emptyArrows,
  },
};
