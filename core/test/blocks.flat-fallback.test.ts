import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectFlatFallbackBlocks } from '../src/blocks/flat-fallback.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-flat-fallback-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function mkdirs(root: string, ...relativeDirs: string[]) {
  for (const dir of relativeDirs) mkdirSync(resolve(root, dir), { recursive: true });
}

describe('detectFlatFallbackBlocks — top-level folders under src/', () => {
  it('produces one block per checked-in flat-repo fixture folder', () => {
    const fixture = resolve(import.meta.dirname, 'fixtures/flat-repo');
    const blocks = detectFlatFallbackBlocks(fixture);

    expect(blocks.map((b) => b.path).sort()).toEqual(['src/api', 'src/auth', 'src/ui']);
    expect(blocks.map((b) => b.name).sort()).toEqual(['api', 'auth', 'ui']);
  });

  it('ignores a file sitting directly inside src/ (not a directory)', () => {
    const root = createTempRepo();
    mkdirs(root, 'src/auth');
    writeFileSync(resolve(root, 'src/index.ts'), 'export {};');

    expect(detectFlatFallbackBlocks(root)).toEqual([{ name: 'auth', path: 'src/auth' }]);
  });

  it('ignores dot-directories and node_modules inside src/', () => {
    const root = createTempRepo();
    mkdirs(root, 'src/auth', 'src/.cache', 'src/node_modules/some-dep');

    expect(detectFlatFallbackBlocks(root)).toEqual([{ name: 'auth', path: 'src/auth' }]);
  });

  it('returns no candidates when src/ has no subdirectories', () => {
    const root = createTempRepo();
    mkdirs(root, 'src');
    writeFileSync(resolve(root, 'src/index.ts'), 'export {};');

    expect(detectFlatFallbackBlocks(root)).toEqual([]);
  });

  it('returns no candidates when there is no top-level src/ at all', () => {
    const root = createTempRepo();
    mkdirs(root, 'lib/auth');

    expect(detectFlatFallbackBlocks(root)).toEqual([]);
  });

  it('returns no candidates for a completely empty repo', () => {
    const root = createTempRepo();
    expect(detectFlatFallbackBlocks(root)).toEqual([]);
  });

  it('follows a symlinked block directory instead of silently dropping it', () => {
    const root = createTempRepo();
    mkdirs(root, 'vendor/real-auth', 'src');
    symlinkSync(resolve(root, 'vendor/real-auth'), resolve(root, 'src/auth'), 'dir');

    const blocks = detectFlatFallbackBlocks(root);
    expect(blocks).toEqual([{ name: 'auth', path: 'src/auth' }]);
  });
});
