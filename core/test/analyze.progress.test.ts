import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import type { Progress } from '../src/types.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-analyze-progress-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function writeJson(path: string, value: unknown) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function writeText(path: string, contents: string) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

function setupFlatFixture(root: string) {
  writeJson(resolve(root, 'package.json'), { name: 'progress-test-repo' });
  writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');
  writeText(resolve(root, 'src/pkgB/index.ts'), 'export const b = 1;\n');
}

describe('analyze — progress: full scan (no cacheDir)', () => {
  it('reports blocks/edges/risks/cache in order, each out of a total of 4', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const events: Progress[] = [];

    await analyze({ rootDir: root, onProgress: (p) => events.push(p) });

    expect(events).toEqual([
      { phase: 'blocks', done: 1, total: 4 },
      { phase: 'edges', done: 2, total: 4 },
      { phase: 'risks', done: 3, total: 4 },
      { phase: 'cache', done: 4, total: 4 },
    ]);
  });

  it('never throws and does not require onProgress at all', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    await expect(analyze({ rootDir: root })).resolves.toBeDefined();
  });
});

describe('analyze — progress: cold start with cacheDir', () => {
  it('reports all four phases on a cold cache-dir run', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const cacheDir = resolve(root, '.cache');
    const events: Progress[] = [];

    await analyze({ rootDir: root, cacheDir, onProgress: (p) => events.push(p) });

    expect(events.map((e) => e.phase)).toEqual(['blocks', 'edges', 'risks', 'cache']);
  });
});

describe('analyze — progress: unchanged cache hit does no re-analysis, so no progress fires', () => {
  it('a second call with nothing changed emits zero progress events', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const cacheDir = resolve(root, '.cache');

    await analyze({ rootDir: root, cacheDir });
    const events: Progress[] = [];
    const second = await analyze({ rootDir: root, cacheDir, onProgress: (p) => events.push(p) });

    expect(second.meta.cacheHit).toBe(true);
    expect(events).toEqual([]);
  });
});

describe('analyze — progress: content-changed delta still reports all four phases', () => {
  it('a scoped delta re-run reports blocks/edges/risks/cache, same as a full scan', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const cacheDir = resolve(root, '.cache');

    await analyze({ rootDir: root, cacheDir });
    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 2;\n');

    const events: Progress[] = [];
    const after = await analyze({ rootDir: root, cacheDir, onProgress: (p) => events.push(p) });

    expect(after.meta.cacheHit).toBe(true);
    expect(events.map((e) => e.phase)).toEqual(['blocks', 'edges', 'risks', 'cache']);
  });
});
