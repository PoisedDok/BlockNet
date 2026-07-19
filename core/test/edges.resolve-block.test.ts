import { describe, expect, it } from 'vitest';
import { resolveBlock, ROOT_BLOCK_ID } from '../src/edges/resolve-block.js';
import type { BlockNode } from '../src/types.js';

function block(path: string): BlockNode {
  return { id: path, name: path, path, pills: [], fileCount: 0, riskCount: 0 };
}

describe('resolveBlock', () => {
  const blocks = [block('packages/a'), block('packages/b'), block('packages/ab')];

  it('matches a file directly inside a block', () => {
    expect(resolveBlock('packages/a/src/index.ts', blocks)).toBe('packages/a');
  });

  it('matches a file at the block path exactly (no trailing segment)', () => {
    expect(resolveBlock('packages/a/package.json', blocks)).toBe('packages/a');
  });

  it('does not match a sibling block whose path is a string-prefix but not a path-segment prefix', () => {
    // "packages/a" must not swallow "packages/ab/..." just because the string "packages/a"
    // is a textual prefix of "packages/ab" — segment boundaries matter.
    expect(resolveBlock('packages/ab/src/index.ts', blocks)).toBe('packages/ab');
  });

  it('falls back to the root sentinel for a file matching no detected block', () => {
    expect(resolveBlock('README.md', blocks)).toBe(ROOT_BLOCK_ID);
    expect(resolveBlock('scripts/build.ts', blocks)).toBe(ROOT_BLOCK_ID);
  });

  it('picks the longest (most specific) matching block when blocks nest', () => {
    const nested = [block('packages/a'), block('packages/a/nested')];
    expect(resolveBlock('packages/a/nested/deep/file.ts', nested)).toBe('packages/a/nested');
  });

  it('returns the root sentinel when given zero blocks', () => {
    expect(resolveBlock('src/index.ts', [])).toBe(ROOT_BLOCK_ID);
  });
});
