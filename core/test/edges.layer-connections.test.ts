import { describe, expect, it } from 'vitest';
import { resolveLayerConnections } from '../src/edges/layer-connections.js';
import type { FileEdge, LayerItemBoundary } from '../src/types.js';

function fileEdge(sourceFile: string, targetFile: string): FileEdge {
  return { sourceFile, targetFile, line: 1, statement: `import from '${targetFile}'` };
}

function folder(id: string, path = id): LayerItemBoundary {
  return { id, path, isFolder: true };
}

function file(id: string, path = id): LayerItemBoundary {
  return { id, path, isFolder: false };
}

describe('resolveLayerConnections — intra-layer edges', () => {
  it('drops a file edge fully contained inside one folder-item\'s own subtree', () => {
    const { edges, arrows } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'apps/web/b.ts')],
      [folder('apps/web')],
      '',
    );
    expect(edges).toHaveLength(0);
    expect(arrows).toHaveLength(0);
  });

  it('renders an edge between two different folder-items in the same layer', () => {
    const { edges } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'apps/api/b.ts')],
      [folder('apps/web'), folder('apps/api')],
      '',
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'apps/web', target: 'apps/api', id: 'apps/web->apps/api' });
  });

  it('renders an edge between a folder-item and a file-item in the same layer', () => {
    const { edges } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'index.ts')],
      [folder('apps/web'), file('index.ts')],
      '',
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'apps/web', target: 'index.ts' });
  });

  it('aggregates multiple crossing file edges between the same item pair into one edge', () => {
    const { edges } = resolveLayerConnections(
      [
        fileEdge('apps/web/a.ts', 'apps/api/b.ts'),
        fileEdge('apps/web/c.ts', 'apps/api/d.ts'),
        fileEdge('apps/web/e.ts', 'apps/api/f.ts'),
      ],
      [folder('apps/web'), folder('apps/api')],
      '',
    );
    expect(edges).toHaveLength(1);
  });

  it('keeps both directions between the same item pair as separate edges', () => {
    const { edges } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'apps/api/b.ts'), fileEdge('apps/api/b.ts', 'apps/web/a.ts')],
      [folder('apps/web'), folder('apps/api')],
      '',
    );
    expect(edges).toHaveLength(2);
  });

  it('drops a resolved self-import (same file both sides)', () => {
    const { edges, arrows } = resolveLayerConnections(
      [fileEdge('index.ts', 'index.ts')],
      [file('index.ts')],
      '',
    );
    expect(edges).toHaveLength(0);
    expect(arrows).toHaveLength(0);
  });

  it('ignores an edge where neither endpoint resolves to any item in this layer', () => {
    const { edges, arrows } = resolveLayerConnections(
      [fileEdge('services/x.ts', 'services/y.ts')],
      [folder('apps/web'), folder('apps/api')],
      '',
    );
    expect(edges).toHaveLength(0);
    expect(arrows).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(resolveLayerConnections([], [], '')).toEqual({ edges: [], arrows: [] });
  });
});

describe('resolveLayerConnections — inter-layer arrows, direction', () => {
  it('points down when the off-screen target is deeper than the current layer\'s items', () => {
    // 'apps/api' is deliberately NOT one of the current items — otherwise this target would
    // resolve INSIDE it (an intra-layer edge, not off-screen at all) rather than testing the
    // off-screen-and-deeper case this test means to check.
    const { arrows } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'apps/api/nested/deep/b.ts')],
      [folder('apps/web')],
      '',
    );
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toMatchObject({ direction: 'down', targetFile: 'apps/api/nested/deep/b.ts' });
  });

  it('points up when the off-screen target is an ancestor file (shallower)', () => {
    const { arrows } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'package.json')],
      [folder('apps/web')],
      'apps',
    );
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toMatchObject({ direction: 'up', targetFile: 'package.json' });
  });

  it('points up for a same-depth cousin-branch file (no lateral arrow variant)', () => {
    const { arrows } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'services/x.ts')],
      [folder('apps/web')],
      'apps',
    );
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.direction).toBe('up');
  });

  it('collapses multiple edges from different visible items to the SAME off-screen target into one arrow', () => {
    const { arrows } = resolveLayerConnections(
      [
        fileEdge('apps/web/a.ts', 'apps/legacy/shared.ts'),
        fileEdge('apps/api/b.ts', 'apps/legacy/shared.ts'),
      ],
      [folder('apps/web'), folder('apps/api')],
      '',
    );
    // two DIFFERENT visible items both point at the same off-screen file: one arrow each
    // (attached to its own source item), not a single disembodied arrow.
    expect(arrows).toHaveLength(2);
    expect(arrows.every((a) => a.targetFile === 'apps/legacy/shared.ts')).toBe(true);
  });

  it('collapses multiple edges from the SAME visible item to the SAME off-screen target into one arrow', () => {
    const { arrows } = resolveLayerConnections(
      [
        fileEdge('apps/web/a.ts', 'apps/legacy/shared.ts'),
        fileEdge('apps/web/b.ts', 'apps/legacy/shared.ts'),
        fileEdge('apps/web/c.ts', 'apps/legacy/shared.ts'),
      ],
      [folder('apps/web')],
      '',
    );
    expect(arrows).toHaveLength(1);
  });

  it('renders distinct arrows for distinct off-screen target files from the same visible item', () => {
    const { arrows } = resolveLayerConnections(
      [
        fileEdge('apps/web/a.ts', 'apps/legacy/one.ts'),
        fileEdge('apps/web/a.ts', 'apps/legacy/two.ts'),
      ],
      [folder('apps/web')],
      '',
    );
    expect(arrows).toHaveLength(2);
    expect(arrows.map((a) => a.targetFile).sort()).toEqual(['apps/legacy/one.ts', 'apps/legacy/two.ts']);
  });

  it('resolves an arrow to a file-item source, not just folder-items', () => {
    const { arrows } = resolveLayerConnections(
      [fileEdge('index.ts', 'apps/web/deep/x.ts')],
      [file('index.ts')],
      '',
    );
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toMatchObject({ sourceItemId: 'index.ts', direction: 'down' });
  });
});

describe('resolveLayerConnections — risk propagation', () => {
  it('defaults an edge/arrow to risk: false when no riskyPairs set is given', () => {
    const { edges, arrows } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'apps/api/b.ts'), fileEdge('apps/web/a.ts', 'services/x.ts')],
      [folder('apps/web'), folder('apps/api')],
      '',
    );
    expect(edges[0]?.risk).toBe(false);
    expect(arrows[0]?.risk).toBe(false);
  });

  it('flags an intra-layer edge risky when its raw pair is in riskyPairs', () => {
    const riskyPairs = new Set(['apps/web/a.ts\0apps/api/b.ts']);
    const { edges } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'apps/api/b.ts')],
      [folder('apps/web'), folder('apps/api')],
      '',
      riskyPairs,
    );
    expect(edges[0]?.risk).toBe(true);
  });

  it('flags an inter-layer arrow risky when its raw pair is in riskyPairs', () => {
    const riskyPairs = new Set(['apps/web/a.ts\0services/x.ts']);
    const { arrows } = resolveLayerConnections(
      [fileEdge('apps/web/a.ts', 'services/x.ts')],
      [folder('apps/web')],
      '',
      riskyPairs,
    );
    expect(arrows[0]?.risk).toBe(true);
  });

  it('OR-accumulates risk across multiple raw edges aggregated into one item-pair edge — a later risky pair still flips an already-created non-risky entry', () => {
    const riskyPairs = new Set(['apps/web/c.ts\0apps/api/d.ts']);
    const { edges } = resolveLayerConnections(
      [
        fileEdge('apps/web/a.ts', 'apps/api/b.ts'), // not risky, creates the entry first
        fileEdge('apps/web/c.ts', 'apps/api/d.ts'), // risky, must flip the SAME entry to true
      ],
      [folder('apps/web'), folder('apps/api')],
      '',
      riskyPairs,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]?.risk).toBe(true);
  });

  it('OR-accumulates risk the same way for arrows aggregated to the same off-screen target', () => {
    const riskyPairs = new Set(['apps/web/b.ts\0apps/legacy/shared.ts']);
    const { arrows } = resolveLayerConnections(
      [
        fileEdge('apps/web/a.ts', 'apps/legacy/shared.ts'), // not risky, creates the entry first
        fileEdge('apps/web/b.ts', 'apps/legacy/shared.ts'), // risky, must flip the SAME entry
      ],
      [folder('apps/web')],
      '',
      riskyPairs,
    );
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.risk).toBe(true);
  });
});

describe('resolveLayerConnections — path-content collision safety', () => {
  it('does not merge two genuinely different item pairs whose ids would collide under naive string concatenation', () => {
    const collidingItems = [folder('a->b'), folder('a'), folder('c'), folder('b->c')];
    const { edges } = resolveLayerConnections(
      [fileEdge('a->b/x.ts', 'c/y.ts'), fileEdge('a/x.ts', 'b->c/y.ts')],
      collidingItems,
      '',
    );
    expect(edges).toHaveLength(2);
  });
});
