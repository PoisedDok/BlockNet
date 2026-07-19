import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRealPathDedup } from '../src/realpath-dedup.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-realpath-dedup-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('createRealPathDedup', () => {
  it('returns false the first time a directory is seen, true every time after', () => {
    const root = createTempRepo();
    mkdirSync(resolve(root, 'a'), { recursive: true });
    const alreadyVisited = createRealPathDedup();

    expect(alreadyVisited(resolve(root, 'a'))).toBe(false);
    expect(alreadyVisited(resolve(root, 'a'))).toBe(true);
    expect(alreadyVisited(resolve(root, 'a'))).toBe(true);
  });

  it('treats a symlink alias resolving to an already-visited real directory as already visited', () => {
    const root = createTempRepo();
    mkdirSync(resolve(root, 'real'), { recursive: true });
    symlinkSync(resolve(root, 'real'), resolve(root, 'alias'), 'dir');
    const alreadyVisited = createRealPathDedup();

    expect(alreadyVisited(resolve(root, 'real'))).toBe(false);
    expect(alreadyVisited(resolve(root, 'alias'))).toBe(true);
  });

  it('treats an unresolvable directory (does not exist) as already visited — skip, never crash', () => {
    const root = createTempRepo();
    const alreadyVisited = createRealPathDedup();

    expect(alreadyVisited(resolve(root, 'nonexistent'))).toBe(true);
  });

  it('keeps state independent across separate trackers', () => {
    const root = createTempRepo();
    mkdirSync(resolve(root, 'a'), { recursive: true });

    const trackerOne = createRealPathDedup();
    const trackerTwo = createRealPathDedup();

    expect(trackerOne(resolve(root, 'a'))).toBe(false);
    expect(trackerTwo(resolve(root, 'a'))).toBe(false);
  });
});
