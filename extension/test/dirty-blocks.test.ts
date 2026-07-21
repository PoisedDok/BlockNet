import { describe, expect, it } from 'vitest';
import { dirtyBlockIds } from '../src/dirty-blocks.js';

describe('dirtyBlockIds', () => {
  it('marks a block dirty when a file directly under its path is dirty', () => {
    const blocks = [{ id: 'apps/web', path: 'apps/web' }];
    expect(dirtyBlockIds(blocks, ['apps/web/lib/data.ts'])).toEqual(new Set(['apps/web']));
  });

  it('marks a block dirty when its path itself is the dirty entry (a single-file block)', () => {
    const blocks = [{ id: 'scripts/build.ts', path: 'scripts/build.ts' }];
    expect(dirtyBlockIds(blocks, ['scripts/build.ts'])).toEqual(new Set(['scripts/build.ts']));
  });

  it('does not mark a block dirty for a sibling directory sharing a name prefix', () => {
    // apps/web-utils is a sibling of apps/web, not a file under it — a naive startsWith(block.path)
    // without the trailing-slash boundary check would wrongly match this.
    const blocks = [{ id: 'apps/web', path: 'apps/web' }];
    expect(dirtyBlockIds(blocks, ['apps/web-utils/foo.ts'])).toEqual(new Set());
  });

  it('leaves unrelated blocks untouched', () => {
    const blocks = [
      { id: 'apps/web', path: 'apps/web' },
      { id: 'packages/db', path: 'packages/db' },
    ];
    expect(dirtyBlockIds(blocks, ['apps/web/index.ts'])).toEqual(new Set(['apps/web']));
  });

  it('marks multiple blocks dirty from a mixed dirty-file list', () => {
    const blocks = [
      { id: 'apps/web', path: 'apps/web' },
      { id: 'packages/db', path: 'packages/db' },
      { id: 'packages/ui', path: 'packages/ui' },
    ];
    expect(dirtyBlockIds(blocks, ['apps/web/index.ts', 'packages/db/schema.ts'])).toEqual(
      new Set(['apps/web', 'packages/db']),
    );
  });

  it('returns an empty set for an empty dirty-file list', () => {
    const blocks = [{ id: 'apps/web', path: 'apps/web' }];
    expect(dirtyBlockIds(blocks, [])).toEqual(new Set());
  });

  it('never marks the synthetic "(root)" block dirty, even for a dirty top-level file — a known, accepted v1 limitation', () => {
    const blocks = [{ id: '(root)', path: '(root)' }];
    expect(dirtyBlockIds(blocks, ['index.ts'])).toEqual(new Set());
  });
});
