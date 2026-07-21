import type { Edge, MicroFileEdge, Risk } from '@blocknet/core';
import type { WebviewBlockNode, WebviewMicroFileNode } from '../../../src/shared/protocol.js';

// Synthetic 30-block/100-edge fixture — Task 7's stated scale target for pan/zoom/drag/select
// smoothness (docs/planning/TASKS-V1.md). Generated, not hand-authored: real repos this size
// have too many blocks to name individually, and what matters for this fixture is count and
// connectivity shape, not realistic names.

const BLOCK_COUNT = 30;
const EDGE_COUNT = 100;

const risk: Risk = {
  tag: 'CIRCULAR',
  oneLine: 'synthetic cycle for stress-testing risk rendering at scale',
  explain: 'Generated fixture edge, not a real finding.',
  fix: 'n/a — fixture data',
  source: 'block-0',
  target: 'block-1',
  evidence: [],
};

export const stressNodes: WebviewBlockNode[] = Array.from({ length: BLOCK_COUNT }, (_, i) => ({
  id: `block-${i}`,
  name: `block-${i}`,
  path: `packages/block-${i}`,
  pills: i % 3 === 0 ? ['typescript', 'react'] : ['typescript'],
  fileCount: (i % 9) + 1,
  riskCount: i % 7 === 0 ? 1 : 0,
  dirty: i % 5 === 0,
}));

export const stressEdges: Edge[] = Array.from({ length: EDGE_COUNT }, (_, i) => {
  const source = i % BLOCK_COUNT;
  const target = (i * 7 + 3) % BLOCK_COUNT;
  return {
    id: `edge-${i}`,
    source: `block-${source}`,
    target: `block-${target}`,
    importCount: (i % 5) + 1,
    ...(i % 7 === 0 && source !== target ? { risk } : {}),
  };
}).filter((e) => e.source !== e.target);

// v2.0 micro view (docs/planning/ROADMAP-V2.md) dev/QA fixture — only block-0 has micro data;
// double-clicking any other block exercises the graph/micro/error fallback path (GraphView.tsx
// falls back to the macro view with an inline banner), which the sample fixture's fully-
// populated dataset never reaches. Full per-block-of-30 micro fixtures aren't built here:
// micro-at-stress-scale is its own, separately-tracked perf question (ROADMAP-V2.md's own "micro
// multiplies node count 10-100x and needs its own perf work" note), not something this fixture
// needs to answer to verify the cross-fade/loading/error mechanics themselves.
export const stressMicroByBlock: Record<string, { files: WebviewMicroFileNode[]; edges: MicroFileEdge[] }> = {
  'block-0': {
    files: [
      { id: 'packages/block-0/src/index.ts', name: 'index.ts', path: 'packages/block-0/src/index.ts', loc: 14, dirty: true, risk: false },
      { id: 'packages/block-0/src/util.ts', name: 'util.ts', path: 'packages/block-0/src/util.ts', loc: 22, dirty: false, risk: false },
    ],
    edges: [{ id: 'packages/block-0/src/index.ts->packages/block-0/src/util.ts', source: 'packages/block-0/src/index.ts', target: 'packages/block-0/src/util.ts', risk: false }],
  },
};
