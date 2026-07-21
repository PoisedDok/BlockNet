import type { BlockNode, Edge, Risk } from '@blocknet/core';

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

export const stressNodes: BlockNode[] = Array.from({ length: BLOCK_COUNT }, (_, i) => ({
  id: `block-${i}`,
  name: `block-${i}`,
  path: `packages/block-${i}`,
  pills: i % 3 === 0 ? ['typescript', 'react'] : ['typescript'],
  fileCount: (i % 9) + 1,
  riskCount: i % 7 === 0 ? 1 : 0,
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
