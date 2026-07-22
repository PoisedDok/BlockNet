import { describe, expect, it } from 'vitest';
import { itemsForLayer } from '../src/edges/layer-items.js';
import type { BlockNode } from '../src/types.js';

function block(path: string): BlockNode {
  return { id: path, name: path, path, pills: [], fileCount: 0, riskCount: 0 };
}

describe('itemsForLayer — layer 0 (repo root)', () => {
  const blocks = [block('apps/web'), block('apps/api')];
  const allFiles = [
    'apps/web/src/index.ts',
    'apps/web/package.json',
    'apps/api/src/index.ts',
    'package.json',
    'docs/architecture.md',
    'docs/planning/roadmap.md',
    'README.md',
  ];

  it('includes every detected block as a folder item', () => {
    const items = itemsForLayer(allFiles, '', blocks);
    expect(items.filter((i) => i.isFolder && (i.id === 'apps/web' || i.id === 'apps/api'))).toHaveLength(2);
  });

  it('includes a loose root-level file (not claimed by any block) as a file item', () => {
    const items = itemsForLayer(allFiles, '', blocks);
    expect(items).toContainEqual({ id: 'package.json', path: 'package.json', isFolder: false });
    expect(items).toContainEqual({ id: 'README.md', path: 'README.md', isFolder: false });
  });

  it('collapses a loose root-level folder not claimed by any block into ONE folder item, not a file per nested doc', () => {
    const items = itemsForLayer(allFiles, '', blocks);
    const docsItems = items.filter((i) => i.id.startsWith('docs'));
    expect(docsItems).toEqual([{ id: 'docs', path: 'docs', isFolder: true }]);
  });

  it('never lists a block-claimed file as a loose root item', () => {
    const items = itemsForLayer(allFiles, '', blocks);
    expect(items.some((i) => i.id.includes('apps/web/src'))).toBe(false);
  });

  it('excludes a block nested inside another block from layer 0 (compact-folder behavior)', () => {
    const nestedBlocks = [block('extension'), block('extension/webview')];
    const files = ['extension/src/index.ts', 'extension/webview/src/App.tsx'];
    const items = itemsForLayer(files, '', nestedBlocks);
    expect(items.map((i) => i.id)).toEqual(['extension']);
  });

  it('returns only block items when there are no loose root files', () => {
    const items = itemsForLayer(['apps/web/x.ts'], '', [block('apps/web')]);
    expect(items).toEqual([{ id: 'apps/web', path: 'apps/web', isFolder: true }]);
  });

  it('degrades to a plain root file/folder listing when no blocks are detected at all', () => {
    const items = itemsForLayer(['src/index.ts', 'README.md'], '', []);
    expect(items.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'README.md', path: 'README.md', isFolder: false },
      { id: 'src', path: 'src', isFolder: true },
    ]);
  });
});

describe('itemsForLayer — a block layer', () => {
  const blocks = [block('apps/web'), block('apps/web/legacy')];
  const allFiles = [
    'apps/web/src/index.ts',
    'apps/web/src/util.ts',
    'apps/web/package.json',
    'apps/web/legacy/old.ts',
  ];

  it('shows direct children only: a subdirectory as a folder item, a direct file as a file item, PLUS the nested block itself', () => {
    const items = itemsForLayer(allFiles, 'apps/web', blocks);
    expect(items.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'apps/web/legacy', path: 'apps/web/legacy', isFolder: true },
      { id: 'apps/web/package.json', path: 'apps/web/package.json', isFolder: false },
      { id: 'apps/web/src', path: 'apps/web/src', isFolder: true },
    ]);
  });

  it('surfaces a MORE SPECIFIC nested block as its own folder item at its enclosing block\'s own layer (compact-folder rule, not just excluded)', () => {
    const items = itemsForLayer(allFiles, 'apps/web', blocks);
    expect(items).toContainEqual({ id: 'apps/web/legacy', path: 'apps/web/legacy', isFolder: true });
    // Its own files never leak in as a SEPARATE plain-folder/file item alongside the block item —
    // exactly one item represents it, the block boundary itself.
    expect(items.filter((i) => i.id.startsWith('apps/web/legacy'))).toHaveLength(1);
  });

  it('surfaces a doubly-nested block only ONE level at a time — never skips straight to the deepest layer', () => {
    // A real bug this locks in: the original itemsForLayer only ever injected nested blocks at
    // layerPath === '', so a block nested under ANOTHER block never appeared as an item at any
    // layer at all. Verifies the fix generalizes past a single level of nesting.
    const chain = [block('apps/web'), block('apps/web/legacy'), block('apps/web/legacy/deep')];
    const files = ['apps/web/src/x.ts', 'apps/web/legacy/old.ts', 'apps/web/legacy/deep/y.ts'];

    const atWeb = itemsForLayer(files, 'apps/web', chain);
    expect(atWeb.map((i) => i.id).sort()).toEqual(['apps/web/legacy', 'apps/web/src']);

    const atLegacy = itemsForLayer(files, 'apps/web/legacy', chain);
    expect(atLegacy.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'apps/web/legacy/deep', path: 'apps/web/legacy/deep', isFolder: true },
      { id: 'apps/web/legacy/old.ts', path: 'apps/web/legacy/old.ts', isFolder: false },
    ]);
  });

  it('does not surface files two-plus segments down as separate items (grouped under one folder item)', () => {
    const items = itemsForLayer(
      ['apps/web/src/a.ts', 'apps/web/src/nested/b.ts', 'apps/web/src/nested/deep/c.ts'],
      'apps/web',
      [block('apps/web')],
    );
    expect(items).toEqual([{ id: 'apps/web/src', path: 'apps/web/src', isFolder: true }]);
  });
});

describe('itemsForLayer — a plain (non-block) folder layer', () => {
  it('groups a plain folder\'s own direct children the same way a block does', () => {
    const items = itemsForLayer(
      ['docs/architecture.md', 'docs/planning/roadmap.md', 'docs/README.md'],
      'docs',
      [],
    );
    expect(items.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'docs/architecture.md', path: 'docs/architecture.md', isFolder: false },
      { id: 'docs/planning', path: 'docs/planning', isFolder: true },
      { id: 'docs/README.md', path: 'docs/README.md', isFolder: false },
    ]);
  });

  it('scopes correctly when a plain folder sits inside a block alongside a nested more-specific block', () => {
    const blocks = [block('apps/web'), block('apps/web/legacy')];
    const items = itemsForLayer(
      ['apps/web/src/a.ts', 'apps/web/src/legacy-inside-src/x.ts'],
      'apps/web/src',
      blocks,
    );
    expect(items.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'apps/web/src/a.ts', path: 'apps/web/src/a.ts', isFolder: false },
      { id: 'apps/web/src/legacy-inside-src', path: 'apps/web/src/legacy-inside-src', isFolder: true },
    ]);
  });
});
