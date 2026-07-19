import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { walkRealFiles } from '../src/file-walk.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-file-walk-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function writeFile(path: string, contents = '') {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

describe('walkRealFiles — generic all-languages file inventory', () => {
  it('finds every real file regardless of extension or language', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'src/index.ts'));
    writeFile(resolve(root, 'backend/main.py'));
    writeFile(resolve(root, 'service/main.go'));
    writeFile(resolve(root, 'README.md'));
    writeFile(resolve(root, 'data.json'));

    expect(walkRealFiles(root).sort()).toEqual(
      ['README.md', 'backend/main.py', 'data.json', 'service/main.go', 'src/index.ts'].sort(),
    );
  });

  it('finds test files — they are real files like any other, never specially excluded', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'src/__tests__/index.test.ts'));
    writeFile(resolve(root, 'tests/test_main.py'));

    expect(walkRealFiles(root).sort()).toEqual(['src/__tests__/index.test.ts', 'tests/test_main.py'].sort());
  });

  it('excludes node_modules entirely', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'src/index.ts'));
    writeFile(resolve(root, 'node_modules/some-dep/index.js'));

    expect(walkRealFiles(root)).toEqual(['src/index.ts']);
  });

  it('excludes dist/build/out/coverage output directories', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'src/index.ts'));
    writeFile(resolve(root, 'dist/index.js'));
    writeFile(resolve(root, 'build/index.js'));
    writeFile(resolve(root, 'out/index.js'));
    writeFile(resolve(root, 'coverage/index.html'));

    expect(walkRealFiles(root)).toEqual(['src/index.ts']);
  });

  it('excludes other languages\' build/dependency-output directories — a real Rust ' +
    'target/ directory measured at 131,144 files counted as source before this existed', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'src/main.rs'));
    writeFile(resolve(root, 'target/debug/deps/whatever.rlib'));
    writeFile(resolve(root, 'src/__pycache__/module.cpython-311.pyc'));
    writeFile(resolve(root, 'venv/lib/site-packages/thing.py'));
    writeFile(resolve(root, 'vendor/some-dep/thing.go'));

    expect(walkRealFiles(root)).toEqual(['src/main.rs']);
  });

  it('excludes every dot-directory categorically, including framework build caches', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'src/index.ts'));
    writeFile(resolve(root, '.next/generated.js'));
    writeFile(resolve(root, '.git/HEAD'));
    writeFile(resolve(root, '.venv/lib/site-packages/thing.py'));

    expect(walkRealFiles(root)).toEqual(['src/index.ts']);
  });

  it('excludes a top-level dot-file', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'src/index.ts'));
    writeFile(resolve(root, '.env'));

    expect(walkRealFiles(root)).toEqual(['src/index.ts']);
  });

  it('follows a symlinked directory (real target hidden inside node_modules, so only the ' +
    'symlink path is independently discoverable) instead of silently dropping its files', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'node_modules/.store/real/index.ts'));
    symlinkSync(resolve(root, 'node_modules/.store/real'), resolve(root, 'alias'), 'dir');

    expect(walkRealFiles(root)).toEqual(['alias/index.ts']);
  });

  it('counts a real directory + a separately-discoverable symlink alias to it exactly ' +
    'once, never twice — the same real-path dedup that fixes structural.ts\'s ' +
    'dual-discoverability bug applies here too', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'real/index.ts'));
    symlinkSync(resolve(root, 'real'), resolve(root, 'alias'), 'dir');

    expect(walkRealFiles(root)).toHaveLength(1);
  });

  it('counts a single real file reachable via multiple symlinked FILE paths (not just ' +
    'symlinked directories) exactly once — a real monorepo pattern (Nx/Bazel-style tooling ' +
    'symlinking one shared config file into several package directories)', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'shared/config.ts'));
    mkdirSync(resolve(root, 'pkg-a'), { recursive: true });
    mkdirSync(resolve(root, 'pkg-b'), { recursive: true });
    symlinkSync(resolve(root, 'shared/config.ts'), resolve(root, 'pkg-a/config.ts'));
    symlinkSync(resolve(root, 'shared/config.ts'), resolve(root, 'pkg-b/config.ts'));

    expect(walkRealFiles(root)).toHaveLength(1);
  });

  it('does not hang or blow up on a branching symlink cycle', () => {
    const root = createTempRepo();
    const branching = 40;
    mkdirSync(resolve(root, 'a'), { recursive: true });
    mkdirSync(resolve(root, 'b'), { recursive: true });
    for (let i = 0; i < branching; i++) {
      symlinkSync(resolve(root, 'b'), resolve(root, `a/to-b-${i}`), 'dir');
      symlinkSync(resolve(root, 'a'), resolve(root, `b/to-a-${i}`), 'dir');
    }

    expect(walkRealFiles(root)).toEqual([]);
  }, 3000);

  it('returns an empty array for an empty repo', () => {
    const root = createTempRepo();
    expect(walkRealFiles(root)).toEqual([]);
  });

  it('degrades to skipping an unreadable directory rather than crashing', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'src/index.ts'));
    // A directory that doesn't exist at all — simulates a race with a concurrent delete
    // between listing rootDir and descending into one of its children.
    expect(walkRealFiles(resolve(root, 'does-not-exist'))).toEqual([]);
  });
});
