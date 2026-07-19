import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDependencyCruise } from '../src/edges/depcruise-runner.js';
import { buildFileGraph } from '../src/edges/file-graph.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-file-graph-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function writeText(path: string, contents: string) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

describe('buildFileGraph — checked-in monorepo fixture', () => {
  const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');

  it('produces a FileEdge with the correct statement and line for a relative import', async () => {
    const result = await runDependencyCruise(fixture);
    const edges = buildFileGraph(result, fixture);

    const edge = edges.find(
      (e) => e.sourceFile === 'packages/a/src/index.ts' && e.targetFile === 'packages/a/src/helpers.ts',
    );
    expect(edge).toBeDefined();
    expect(edge?.line).toBe(1);
    expect(edge?.statement).toBe("import { helperA } from './helpers.js';");
  });

  it('produces a FileEdge with the correct statement and line for an aliased import', async () => {
    const result = await runDependencyCruise(fixture);
    const edges = buildFileGraph(result, fixture);

    const edge = edges.find(
      (e) => e.sourceFile === 'packages/a/src/index.ts' && e.targetFile === 'packages/c/src/internal.ts',
    );
    expect(edge).toBeDefined();
    expect(edge?.line).toBe(2);
    expect(edge?.statement).toBe("import { internalThing } from '@c/internal.js';");
  });

  it('produces a FileEdge that resolves to the barrel file itself for a barrel import', async () => {
    const result = await runDependencyCruise(fixture);
    const edges = buildFileGraph(result, fixture);

    const edge = edges.find(
      (e) => e.sourceFile === 'packages/c/src/index.ts' && e.targetFile === 'packages/b/src/index.ts',
    );
    expect(edge).toBeDefined();
    expect(edge?.line).toBe(1);
    expect(edge?.statement).toBe("import { bThing } from '../../b/src/index.js';");
  });

  it('produces edges for both directions of the b<->c cycle', async () => {
    const result = await runDependencyCruise(fixture);
    const edges = buildFileGraph(result, fixture);

    expect(
      edges.some((e) => e.sourceFile === 'packages/b/src/internal.ts' && e.targetFile === 'packages/c/src/index.ts'),
    ).toBe(true);
    expect(
      edges.some((e) => e.sourceFile === 'packages/c/src/index.ts' && e.targetFile === 'packages/b/src/index.ts'),
    ).toBe(true);
  });
});

describe('buildFileGraph — filtering', () => {
  it('excludes core-module and unresolvable dependencies, keeps real local ones', async () => {
    const dir = createTempRepo();
    writeText(
      resolve(dir, 'src/main.ts'),
      [
        "import { local } from './local.js';",
        "import fs from 'node:fs';",
        "import { nope } from './does-not-exist.js';",
        'console.log(local, fs, nope);',
        '',
      ].join('\n'),
    );
    writeText(resolve(dir, 'src/local.ts'), 'export const local = 1;\n');

    const result = await runDependencyCruise(dir);
    const edges = buildFileGraph(result, dir);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      sourceFile: 'src/main.ts',
      targetFile: 'src/local.ts',
      line: 1,
    });
  });

  it('excludes a relative import that resolves outside rootDir entirely', async () => {
    // Ordinary when only a subdirectory of a larger monorepo is analyzed (the same real
    // scenario blocks/fs-utils.ts's toBlockRelativePath already guards against for block
    // detection — see docs/planning/PROGRESS.md's Task 2 entry).
    const dir = createTempRepo();
    writeText(resolve(dir, 'outside/thing.ts'), 'export const thing = 1;\n');
    writeText(
      resolve(dir, 'repo/src/main.ts'),
      "import { thing } from '../../outside/thing.js';\nconsole.log(thing);\n",
    );

    const result = await runDependencyCruise(resolve(dir, 'repo'));
    const edges = buildFileGraph(result, resolve(dir, 'repo'));

    expect(edges).toEqual([]);
  });

  it('does not misattribute evidence to a commented-out import inside a /* */ block comment', async () => {
    const dir = createTempRepo();
    writeText(
      resolve(dir, 'src/main.ts'),
      [
        '/*',
        "import { helper } from './helper.js'; // old approach, kept for reference",
        '*/',
        "import { helper } from './helper.js';",
        'console.log(helper);',
        '',
      ].join('\n'),
    );
    writeText(resolve(dir, 'src/helper.ts'), 'export const helper = 1;\n');

    const result = await runDependencyCruise(dir);
    const edges = buildFileGraph(result, dir);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.line).toBe(4);
  });
});

describe('buildFileGraph — a source file vanishes between scan and read', () => {
  it('skips that file\'s edges instead of crashing the whole build', async () => {
    const dir = createTempRepo();
    writeText(resolve(dir, 'src/main.ts'), "import { b } from './b.js';\nconsole.log(b);\n");
    writeText(resolve(dir, 'src/b.ts'), 'export const b = 1;\n');

    const result = await runDependencyCruise(dir);
    unlinkSync(resolve(dir, 'src/main.ts'));

    expect(() => buildFileGraph(result, dir)).not.toThrow();
    expect(buildFileGraph(result, dir)).toEqual([]);
  });
});
