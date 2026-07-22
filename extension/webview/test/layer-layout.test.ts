import { describe, expect, it } from 'vitest';
import { layoutLayerItems } from '../src/flow/layer-layout.js';

function file(id: string) {
  return { id, kind: 'file' as const };
}

function folder(id: string) {
  return { id, kind: 'folder' as const };
}

function docstack(id: string, fileCount: number) {
  return { id, kind: 'docstack' as const, files: Array.from({ length: fileCount }, (_, i) => ({ path: `doc-${i}.md` })) };
}

function edge(source: string, target: string) {
  return { source, target };
}

describe('layoutLayerItems', () => {
  it('returns a position for every item id, mixing folder and file kinds', () => {
    const items = [folder('apps/web'), file('package.json'), folder('apps/api')];
    const positions = layoutLayerItems(items, []);
    expect(Object.keys(positions).sort()).toEqual(['apps/api', 'apps/web', 'package.json']);
  });

  it('never produces NaN or undefined coordinates', () => {
    const items = [folder('apps/web'), file('index.ts')];
    const positions = layoutLayerItems(items, [edge('apps/web', 'index.ts')]);
    for (const id of ['apps/web', 'index.ts']) {
      expect(Number.isFinite(positions[id]?.x)).toBe(true);
      expect(Number.isFinite(positions[id]?.y)).toBe(true);
    }
  });

  it('places an edge target to the right of its source', () => {
    const items = [folder('apps/web'), folder('apps/api')];
    const positions = layoutLayerItems(items, [edge('apps/web', 'apps/api')]);
    expect(positions['apps/api']!.x).toBeGreaterThan(positions['apps/web']!.x);
  });

  it('handles an edge whose endpoint is not in the item list without throwing', () => {
    const items = [folder('apps/web')];
    expect(() => layoutLayerItems(items, [edge('apps/web', 'ghost')])).not.toThrow();
  });

  it('handles zero items', () => {
    expect(layoutLayerItems([], [])).toEqual({});
  });

  it('includes a docstack item in the layout, small or large', () => {
    const items = [folder('apps/web'), docstack('(docstack)', 2), docstack('docs/(docstack)', 8)];
    const positions = layoutLayerItems(items, []);
    for (const id of ['apps/web', '(docstack)', 'docs/(docstack)']) {
      expect(Number.isFinite(positions[id]?.x)).toBe(true);
      expect(Number.isFinite(positions[id]?.y)).toBe(true);
    }
  });

  it('is deterministic for the same input', () => {
    const items = [folder('apps/web'), file('package.json'), folder('apps/api')];
    const edges = [edge('apps/web', 'apps/api')];
    const first = layoutLayerItems(items, edges);
    const second = layoutLayerItems(items, edges);
    expect(first).toEqual(second);
  });
});
