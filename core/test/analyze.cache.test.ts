import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-analyze-cache-test-'));
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

/** Sets up a flat-fallback fixture (root package.json, no workspaces field, two top-level
 * src/ folders — same detection shape as test/fixtures/flat-repo) in a mutable temp dir. */
function setupFlatFixture(root: string) {
  writeJson(resolve(root, 'package.json'), { name: 'cache-test-repo' });
  writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');
  writeText(resolve(root, 'src/pkgB/index.ts'), 'export const b = 1;\n');
}

function edgePairs(result: Awaited<ReturnType<typeof analyze>>) {
  return Object.fromEntries(result.edges.map((e) => [`${e.source}->${e.target}`, e.importCount]));
}

describe('analyze — cache: cold start', () => {
  it('a first analyze() with a fresh cacheDir is a real full scan (cacheHit: false)', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const cacheDir = resolve(root, '.cache');

    const result = await analyze({ rootDir: root, cacheDir });
    expect(result.meta.cacheHit).toBe(false);
    expect(edgePairs(result)).toEqual({});
  });
});

describe('analyze — cache: unchanged repo loads from cache', () => {
  it('a second analyze() with nothing changed returns cacheHit: true and identical blocks/edges/risks', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const cacheDir = resolve(root, '.cache');

    const first = await analyze({ rootDir: root, cacheDir });
    const second = await analyze({ rootDir: root, cacheDir });

    expect(second.meta.cacheHit).toBe(true);
    expect(second.blocks).toEqual(first.blocks);
    expect(second.edges).toEqual(first.edges);
    expect(second.risks).toEqual(first.risks);
    expect(second.meta.fileCount).toBe(first.meta.fileCount);
  });

  it('a cache hit on an unchanged repo is measurably faster than the cold run that populated it', async () => {
    const root = createTempRepo();
    // A repo big enough that dependency-cruiser's AST-parse/resolution cost (the part the
    // cache hit skips entirely) dominates over fixed per-call overhead (module imports,
    // process startup) — otherwise the timing signal is too small to trust.
    writeJson(resolve(root, 'package.json'), { name: 'perf-test-repo' });
    for (let i = 0; i < 300; i++) {
      writeText(
        resolve(root, `src/mod/file${i}.ts`),
        `import { helper } from './helper.js';\nexport const v${i} = helper + ${i};\n`,
      );
    }
    writeText(resolve(root, 'src/mod/helper.ts'), 'export const helper = 1;\n');
    const cacheDir = resolve(root, '.cache');

    const cold = await analyze({ rootDir: root, cacheDir });
    const warm = await analyze({ rootDir: root, cacheDir });

    expect(cold.meta.cacheHit).toBe(false);
    expect(warm.meta.cacheHit).toBe(true);
    expect(warm.meta.durationMs).toBeLessThan(cold.meta.durationMs);
  });
});

describe('analyze — cache: content-changed scoped delta', () => {
  it('editing one file to add a cross-block import produces the new edge, and is still reported as a cache hit', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const cacheDir = resolve(root, '.cache');

    const before = await analyze({ rootDir: root, cacheDir });
    expect(edgePairs(before)).toEqual({});

    writeText(
      resolve(root, 'src/pkgA/index.ts'),
      "import { b } from '../pkgB/index.js';\nexport const a = 1;\nconsole.log(b);\n",
    );
    const after = await analyze({ rootDir: root, cacheDir });

    expect(after.meta.cacheHit).toBe(true);
    expect(edgePairs(after)).toEqual({ 'src/pkgA->src/pkgB': 1 });
  });

  it('editing the file back to remove the import makes the edge disappear again', async () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'cache-test-repo' });
    writeText(
      resolve(root, 'src/pkgA/index.ts'),
      "import { b } from '../pkgB/index.js';\nexport const a = 1;\nconsole.log(b);\n",
    );
    writeText(resolve(root, 'src/pkgB/index.ts'), 'export const b = 1;\n');
    const cacheDir = resolve(root, '.cache');

    const before = await analyze({ rootDir: root, cacheDir });
    expect(edgePairs(before)).toEqual({ 'src/pkgA->src/pkgB': 1 });

    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');
    const after = await analyze({ rootDir: root, cacheDir });

    expect(after.meta.cacheHit).toBe(true);
    expect(edgePairs(after)).toEqual({});
  });

  it('fileCount and block structure are untouched by a pure content edit (reused from cache, not recomputed)', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const cacheDir = resolve(root, '.cache');

    const before = await analyze({ rootDir: root, cacheDir });
    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 999;\n');
    const after = await analyze({ rootDir: root, cacheDir });

    expect(after.meta.fileCount).toBe(before.meta.fileCount);
    expect(after.blocks.map((b) => ({ id: b.id, fileCount: b.fileCount }))).toEqual(
      before.blocks.map((b) => ({ id: b.id, fileCount: b.fileCount })),
    );
  });
});

describe('analyze — cache: config change forces a full bust', () => {
  it('touching package.json busts the cache even though no source file changed', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const cacheDir = resolve(root, '.cache');

    await analyze({ rootDir: root, cacheDir });
    writeJson(resolve(root, 'package.json'), { name: 'cache-test-repo', dependencies: { chalk: '^5.0.0' } });
    const after = await analyze({ rootDir: root, cacheDir });

    expect(after.meta.cacheHit).toBe(false);
  });

  it('touching tsconfig.json busts the cache even though no source file changed', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    writeJson(resolve(root, 'tsconfig.json'), { compilerOptions: {} });
    const cacheDir = resolve(root, '.cache');

    await analyze({ rootDir: root, cacheDir });
    writeJson(resolve(root, 'tsconfig.json'), { compilerOptions: { paths: { '@/*': ['./src/*'] } } });
    const after = await analyze({ rootDir: root, cacheDir });

    expect(after.meta.cacheHit).toBe(false);
  });
});

describe('analyze — cache: structural change (add/remove) forces a full bust', () => {
  it('adding a new file busts the cache and the new file is reflected in fileCount', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    const cacheDir = resolve(root, '.cache');

    const before = await analyze({ rootDir: root, cacheDir });
    writeText(resolve(root, 'src/pkgA/extra.ts'), 'export const extra = 1;\n');
    const after = await analyze({ rootDir: root, cacheDir });

    expect(after.meta.cacheHit).toBe(false);
    expect(after.meta.fileCount).toBe(before.meta.fileCount + 1);
  });

  it('deleting a file busts the cache and fileCount drops accordingly', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);
    writeText(resolve(root, 'src/pkgA/extra.ts'), 'export const extra = 1;\n');
    const cacheDir = resolve(root, '.cache');

    const before = await analyze({ rootDir: root, cacheDir });
    rmSync(resolve(root, 'src/pkgA/extra.ts'));
    const after = await analyze({ rootDir: root, cacheDir });

    expect(after.meta.cacheHit).toBe(false);
    expect(after.meta.fileCount).toBe(before.meta.fileCount - 1);
  });
});

describe('analyze — cache: no cacheDir means no caching at all', () => {
  it('always reports cacheHit: false when cacheDir is omitted, even across repeated calls', async () => {
    const root = createTempRepo();
    setupFlatFixture(root);

    const first = await analyze({ rootDir: root });
    const second = await analyze({ rootDir: root });

    expect(first.meta.cacheHit).toBe(false);
    expect(second.meta.cacheHit).toBe(false);
  });
});
