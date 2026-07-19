import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { ROOT_BLOCK_ID } from '../src/edges/resolve-block.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-analyze-edges-test-'));
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

describe('analyze — checked-in monorepo fixture (no root-level source files)', () => {
  const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');

  it('produces the correct crossing block edges with importCount and no self-loops', async () => {
    const result = await analyze({ rootDir: fixture });

    const byPair = Object.fromEntries(result.edges.map((e) => [`${e.source}->${e.target}`, e.importCount]));
    expect(byPair).toEqual({
      'packages/a->packages/c': 1,
      'packages/b->packages/c': 1,
      'packages/c->packages/b': 1,
    });
    expect(result.edges.every((e) => e.source !== e.target)).toBe(true);
  });

  it('sets each block\'s real fileCount from the walked file graph', async () => {
    const result = await analyze({ rootDir: fixture });
    const byPath = Object.fromEntries(result.blocks.map((b) => [b.path, b.fileCount]));
    expect(byPath).toEqual({ 'packages/a': 2, 'packages/b': 2, 'packages/c': 2 });
  });

  it('does not append a root block when every file matches a detected block', async () => {
    const result = await analyze({ rootDir: fixture });
    expect(result.blocks.some((b) => b.id === ROOT_BLOCK_ID)).toBe(false);
  });

  it('sets meta.fileCount to the total real files walked', async () => {
    const result = await analyze({ rootDir: fixture });
    expect(result.meta.fileCount).toBe(6);
  });
});

describe('analyze — flat-repo fixture', () => {
  const fixture = resolve(import.meta.dirname, 'fixtures/flat-repo');

  it('produces the api->auth crossing edge from the flat-fallback-detected blocks', async () => {
    const result = await analyze({ rootDir: fixture });
    const byPair = Object.fromEntries(result.edges.map((e) => [`${e.source}->${e.target}`, e.importCount]));
    expect(byPair).toEqual({ 'src/api->src/auth': 1 });
  });
});

describe('analyze — root catch-all block', () => {
  it('appends the synthetic root block, with real fileCount and pills, only when a file matches no detected block', async () => {
    const dir = createTempRepo();
    writeJson(resolve(dir, 'package.json'), {
      name: 'root-test',
      workspaces: ['packages/*'],
      dependencies: { chalk: '^5.0.0' },
    });
    writeJson(resolve(dir, 'packages/a/package.json'), { name: 'a' });
    writeText(
      resolve(dir, 'packages/a/index.ts'),
      "import { helper } from '../../shared.js';\nconsole.log(helper);\n",
    );
    writeText(resolve(dir, 'shared.ts'), 'export const helper = 1;\n');

    const result = await analyze({ rootDir: dir });

    const root = result.blocks.find((b) => b.id === ROOT_BLOCK_ID);
    expect(root).toBeDefined();
    expect(root?.fileCount).toBe(1);
    expect(root?.pills).toEqual(['chalk']);

    const rootEdge = result.edges.find((e) => e.target === ROOT_BLOCK_ID);
    expect(rootEdge).toMatchObject({ source: 'packages/a', target: ROOT_BLOCK_ID, importCount: 1 });
  });

  it('does not appear at all when every file matches a detected block', async () => {
    const dir = createTempRepo();
    writeJson(resolve(dir, 'package.json'), { name: 'root-test', workspaces: ['packages/*'] });
    writeJson(resolve(dir, 'packages/a/package.json'), { name: 'a' });
    writeText(resolve(dir, 'packages/a/index.ts'), 'export {};\n');

    const result = await analyze({ rootDir: dir });
    expect(result.blocks.some((b) => b.id === ROOT_BLOCK_ID)).toBe(false);
    expect(result.edges).toEqual([]);
  });

  it('never produces two BlockNodes with the same id, even if a real detected block\'s path collides with the root sentinel', async () => {
    // A directory literally named "(root)" is legal, if bizarre. A detected block that
    // happens to collide with the sentinel must not cause a duplicate-id BlockNode.
    const dir = createTempRepo();
    writeJson(resolve(dir, 'package.json'), { name: 'collision-test', workspaces: ['(root)'] });
    writeJson(resolve(dir, '(root)/package.json'), { name: 'weird' });
    writeText(resolve(dir, '(root)/index.ts'), 'export {};\n');
    // A genuinely orphaned file (matches no detected block's path prefix) — this is what
    // actually flips `hasRootFiles` true and would previously have triggered a duplicate
    // push, since the "(root)"-named block above doesn't cover it either.
    writeText(resolve(dir, 'scripts/build.ts'), 'export {};\n');

    const result = await analyze({ rootDir: dir });
    const matchingIds = result.blocks.filter((b) => b.id === ROOT_BLOCK_ID);
    expect(matchingIds).toHaveLength(1);
  });
});

describe('analyze — core-module imports', () => {
  it('does not count a Node core module (e.g. "node:fs") as a real file in fileCount or a block\'s fileCount', async () => {
    const dir = createTempRepo();
    writeJson(resolve(dir, 'package.json'), { name: 'core-module-test' });
    writeText(dir + '/src/index.ts', "import fs from 'node:fs';\nconsole.log(fs);\n");

    const result = await analyze({ rootDir: dir });
    // Only src/index.ts itself is a real file — dependency-cruiser also reports the core
    // module as its own phantom module entry, which must not be counted.
    expect(result.meta.fileCount).toBe(1);
    expect(result.blocks.every((b) => b.fileCount === 1)).toBe(true);
  });
});

describe('analyze — empty repo (no source files at all)', () => {
  it('returns zero blocks, zero edges, honest zero fileCount', async () => {
    const dir = createTempRepo();
    const result = await analyze({ rootDir: dir });
    expect(result.blocks).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.meta.fileCount).toBe(0);
  });
});
