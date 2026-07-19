import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-analyze-risks-test-'));
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

describe('analyze — risks on the checked-in monorepo fixture', () => {
  const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');

  it('flags exactly the b<->c cycle as CIRCULAR on both directions, and a->c as BOUNDARY', async () => {
    const result = await analyze({ rootDir: fixture });

    const byPair = Object.fromEntries(result.risks.map((r) => [`${r.source}->${r.target}`, r.tag]));
    expect(byPair).toEqual({
      'packages/b->packages/c': 'CIRCULAR',
      'packages/c->packages/b': 'CIRCULAR',
      'packages/a->packages/c': 'BOUNDARY',
    });
    expect(result.risks).toHaveLength(3);
  });

  it('attaches the matching Risk to each block Edge', async () => {
    const result = await analyze({ rootDir: fixture });

    const bc = result.edges.find((e) => e.id === 'packages/b->packages/c');
    const cb = result.edges.find((e) => e.id === 'packages/c->packages/b');
    const ac = result.edges.find((e) => e.id === 'packages/a->packages/c');
    expect(bc?.risk?.tag).toBe('CIRCULAR');
    expect(cb?.risk?.tag).toBe('CIRCULAR');
    expect(ac?.risk?.tag).toBe('BOUNDARY');
  });

  it('carries real evidence pointing at the actual import statements', async () => {
    const result = await analyze({ rootDir: fixture });
    const boundary = result.risks.find((r) => r.tag === 'BOUNDARY');
    expect(boundary?.evidence).toEqual([
      { file: 'packages/a/src/index.ts', line: 2, statement: "import { internalThing } from '@c/internal.js';" },
    ]);
  });

  it('computes riskCount per block as the number of distinct risks touching it as source or target', async () => {
    const result = await analyze({ rootDir: fixture });
    const byPath = Object.fromEntries(result.blocks.map((b) => [b.path, b.riskCount]));
    // a: 1 (BOUNDARY a->c, as source)
    // b: 2 (CIRCULAR b->c as source, CIRCULAR c->b as target)
    // c: 3 (BOUNDARY a->c as target, CIRCULAR b->c as target, CIRCULAR c->b as source)
    expect(byPath).toMatchObject({ 'packages/a': 1, 'packages/b': 2, 'packages/c': 3 });
  });
});

describe('analyze — flat-repo fixture has no risks', () => {
  it('reports zero risks and zero riskCount for a fixture with no cycles or deep imports', async () => {
    const fixture = resolve(import.meta.dirname, 'fixtures/flat-repo');
    const result = await analyze({ rootDir: fixture });
    expect(result.risks).toEqual([]);
    expect(result.blocks.every((b) => b.riskCount === 0)).toBe(true);
    expect(result.edges.every((e) => e.risk === undefined)).toBe(true);
  });
});

describe('analyze — a clean synthetic repo has zero risks', () => {
  it('produces no false positives on an ordinary two-block repo with a single one-way entry import', async () => {
    const dir = createTempRepo();
    writeJson(resolve(dir, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    writeJson(resolve(dir, 'packages/a/package.json'), { name: 'a' });
    writeJson(resolve(dir, 'packages/b/package.json'), { name: 'b' });
    writeText(resolve(dir, 'packages/a/index.ts'), "import { x } from '../b/index.js';\nconsole.log(x);\n");
    writeText(resolve(dir, 'packages/b/index.ts'), 'export const x = 1;\n');

    const result = await analyze({ rootDir: dir });
    expect(result.risks).toEqual([]);
    expect(result.blocks.every((b) => b.riskCount === 0)).toBe(true);
  });
});
