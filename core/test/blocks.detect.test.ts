import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectBlocks } from '../src/blocks/detect.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-detect-test-'));
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

describe('detectBlocks — cascade (docs/decisions/0005-blocks-auto-detected.md)', () => {
  it('fixture monorepo yields one full BlockNode per workspace member, pills reflecting real deps', () => {
    const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');
    const blocks = detectBlocks(fixture);

    expect(blocks).toHaveLength(3);
    const byPath = Object.fromEntries(blocks.map((b) => [b.path, b]));

    expect(byPath['packages/a']).toEqual({
      id: 'packages/a',
      name: 'a',
      path: 'packages/a',
      pills: ['react'],
      fileCount: 0,
      riskCount: 0,
    });
    expect(byPath['packages/b']?.pills).toEqual(['express']);
    expect(byPath['packages/c']?.pills).toEqual(['pg']);
  });

  it('fixture flat repo yields blocks from top-level src/ folders, pills from the shared root package.json', () => {
    const fixture = resolve(import.meta.dirname, 'fixtures/flat-repo');
    const blocks = detectBlocks(fixture);

    expect(blocks.map((b) => b.path).sort()).toEqual(['src/api', 'src/auth', 'src/ui']);
    for (const block of blocks) {
      expect(block.pills).toEqual(['express']);
      expect(block.fileCount).toBe(0);
      expect(block.riskCount).toBe(0);
      expect(block.id).toBe(block.path);
    }
  });

  it('prefers workspaces over conventional folders when both are present (cascade order)', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    writeJson(resolve(root, 'packages/x/package.json'), { name: 'x' });
    // A conventional-looking folder also exists, but must be ignored: strategy 1 already
    // produced a non-empty result.
    mkdirSync(resolve(root, 'apps/web'), { recursive: true });

    const blocks = detectBlocks(root);
    expect(blocks.map((b) => b.path)).toEqual(['packages/x']);
  });

  it('prefers conventional folders over the flat src/ fallback when workspaces is absent', () => {
    const root = createTempRepo();
    mkdirSync(resolve(root, 'apps/web'), { recursive: true });
    mkdirSync(resolve(root, 'src/auth'), { recursive: true });

    const blocks = detectBlocks(root);
    expect(blocks.map((b) => b.path)).toEqual(['apps/web']);
  });

  it('returns an empty array when no strategy finds anything (root synthetic block is Task 3\'s job, once file resolution exists)', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root' });
    writeFileSync(resolve(root, 'index.ts'), 'export {};');

    expect(detectBlocks(root)).toEqual([]);
  });
});
