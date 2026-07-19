import { describe, expect, it } from 'vitest';
import { aggregateToBlockEdges } from '../src/edges/block-aggregate.js';
import { ROOT_BLOCK_ID } from '../src/edges/resolve-block.js';
import type { BlockNode, FileEdge } from '../src/types.js';

function block(path: string): BlockNode {
  return { id: path, name: path, path, pills: [], fileCount: 0, riskCount: 0 };
}

function fileEdge(sourceFile: string, targetFile: string, line = 1): FileEdge {
  return { sourceFile, targetFile, line, statement: `import from '${targetFile}'` };
}

describe('aggregateToBlockEdges', () => {
  const blocks = [block('packages/a'), block('packages/b')];

  it('drops intra-block file edges — only crossing edges become block Edges', () => {
    const edges = aggregateToBlockEdges(
      [fileEdge('packages/a/x.ts', 'packages/a/y.ts'), fileEdge('packages/a/y.ts', 'packages/a/z.ts')],
      blocks,
    );
    expect(edges).toHaveLength(0);
  });

  it('aggregates multiple crossing file edges between the same block pair into one Edge with a summed importCount', () => {
    const edges = aggregateToBlockEdges(
      [
        fileEdge('packages/a/x.ts', 'packages/b/y.ts'),
        fileEdge('packages/a/x2.ts', 'packages/b/y2.ts'),
        fileEdge('packages/a/x3.ts', 'packages/b/y3.ts'),
      ],
      blocks,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'packages/a', target: 'packages/b', importCount: 3 });
  });

  it('keeps both directions of a bidirectional block relationship as separate Edges', () => {
    const edges = aggregateToBlockEdges(
      [fileEdge('packages/a/x.ts', 'packages/b/y.ts'), fileEdge('packages/b/y.ts', 'packages/a/x.ts')],
      blocks,
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(['packages/a->packages/b', 'packages/b->packages/a']);
    for (const edge of edges) expect(edge.importCount).toBe(1);
  });

  it('routes a file matching no detected block through the root sentinel', () => {
    const edges = aggregateToBlockEdges([fileEdge('scripts/build.ts', 'packages/a/index.ts')], blocks);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: ROOT_BLOCK_ID, target: 'packages/a', importCount: 1 });
  });

  it('assigns a stable, unique id per block-edge pair', () => {
    const edges = aggregateToBlockEdges([fileEdge('packages/a/x.ts', 'packages/b/y.ts')], blocks);
    expect(edges[0]?.id).toBe('packages/a->packages/b');
  });

  it('returns an empty array for an empty input', () => {
    expect(aggregateToBlockEdges([], blocks)).toEqual([]);
  });
});

describe('aggregateToBlockEdges — block paths containing the id-join delimiter', () => {
  it('does not merge two genuinely different block pairs whose "source->target" strings would collide', () => {
    // block "a->b" importing "c" vs block "a" importing "b->c" both stringify to
    // "a->b->c" under naive string concatenation — they must not share aggregation state.
    const collidingBlocks = [block('a->b'), block('a'), block('c'), block('b->c')];
    const edges = aggregateToBlockEdges(
      [fileEdge('a->b/x.ts', 'c/y.ts'), fileEdge('a/x.ts', 'b->c/y.ts')],
      collidingBlocks,
    );
    expect(edges).toHaveLength(2);
    for (const edge of edges) expect(edge.importCount).toBe(1);
  });
});
