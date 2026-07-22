import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { analyzeLayer } from '../src/analyze-layer.js';

const tempDirs: string[] = [];
function createTempCacheDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-analyze-layer-test-'));
  tempDirs.push(dir);
  return dir;
}

function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-analyze-layer-repo-'));
  tempDirs.push(dir);
  return dir;
}

function writeText(path: string, contents: string) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('analyzeLayer — checked-in monorepo fixture', () => {
  const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');

  it('returns undefined when no cache exists yet for this cacheDir', async () => {
    const cacheDir = createTempCacheDir();
    const result = await analyzeLayer({ rootDir: fixture, cacheDir, layerPath: '' });
    expect(result).toBeUndefined();
  });

  it('layer 0 shows every detected block as a folder item, plus loose root files as file items', async () => {
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: fixture, cacheDir });

    const result = await analyzeLayer({ rootDir: fixture, cacheDir, layerPath: '' });
    const byId = Object.fromEntries((result?.items ?? []).map((i) => [i.id, i]));

    expect(byId['packages/a']).toMatchObject({ kind: 'folder', isBlock: true });
    expect(byId['packages/b']).toMatchObject({ kind: 'folder', isBlock: true });
    expect(byId['packages/c']).toMatchObject({ kind: 'folder', isBlock: true });
    expect(byId['package.json']).toMatchObject({ kind: 'file', name: 'package.json' });
    expect(byId['tsconfig.json']).toMatchObject({ kind: 'file', name: 'tsconfig.json' });
  });

  it('a block folder item reuses the block\'s own authoritative fileCount, not a recomputed one', async () => {
    const cacheDir = createTempCacheDir();
    const graph = await analyze({ rootDir: fixture, cacheDir });
    const blockA = graph.blocks.find((b) => b.id === 'packages/a');

    const result = await analyzeLayer({ rootDir: fixture, cacheDir, layerPath: '' });
    const item = result?.items.find((i) => i.id === 'packages/a');
    expect(item).toMatchObject({ kind: 'folder', fileCount: blockA?.fileCount });
  });

  it('drilling into a block shows its direct children: a subfolder as a folder item, a direct file as a file item', async () => {
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: fixture, cacheDir });

    const result = await analyzeLayer({ rootDir: fixture, cacheDir, layerPath: 'packages/a' });
    const byId = Object.fromEntries((result?.items ?? []).map((i) => [i.id, i]));

    expect(byId['packages/a/package.json']).toMatchObject({ kind: 'file' });
    expect(byId['packages/a/src']).toMatchObject({ kind: 'folder', isBlock: false, pills: [] });
  });

  it('drilling one level further shows real files with real LOC', async () => {
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: fixture, cacheDir });

    const result = await analyzeLayer({ rootDir: fixture, cacheDir, layerPath: 'packages/a/src' });
    const byId = Object.fromEntries((result?.items ?? []).map((i) => [i.id, i]));

    expect(byId['packages/a/src/helpers.ts']).toMatchObject({ kind: 'file', name: 'helpers.ts', loc: 3, risk: false });
    // packages/a/src/index.ts made the real BOUNDARY-violation import (analyze.risks.test.ts) —
    // real, evidence-backed risk flag, not a guess.
    expect(byId['packages/a/src/index.ts']).toMatchObject({ kind: 'file', risk: true });
  });

  it('produces intra-layer edges between block folder items at layer 0 (a->c BOUNDARY, b<->c CIRCULAR)', async () => {
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: fixture, cacheDir });

    const result = await analyzeLayer({ rootDir: fixture, cacheDir, layerPath: '' });
    const byPair = Object.fromEntries((result?.edges ?? []).map((e) => [`${e.source}->${e.target}`, e]));
    expect(Object.keys(byPair)).toEqual(
      expect.arrayContaining(['packages/a->packages/c', 'packages/b->packages/c', 'packages/c->packages/b']),
    );
    // a->c is BOUNDARY only, not part of the b<->c cycle — its aggregated edge must not be
    // mislabeled risky just because some OTHER edge at this layer is.
    expect(byPair['packages/a->packages/c']?.risk).toBe(false);
    // b<->c genuinely is the CIRCULAR pair — both directions must carry risk: true.
    expect(byPair['packages/b->packages/c']?.risk).toBe(true);
    expect(byPair['packages/c->packages/b']?.risk).toBe(true);
  });

  it('flags a file risky from a GLOBAL cycle scan, not block-scoped like analyzeMicroBlock — packages/b/src/internal.ts genuinely participates in the b<->c cycle', async () => {
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: fixture, cacheDir });

    const result = await analyzeLayer({ rootDir: fixture, cacheDir, layerPath: 'packages/b/src' });
    const byId = Object.fromEntries((result?.items ?? []).map((i) => [i.id, i]));
    expect(byId['packages/b/src/internal.ts']).toMatchObject({ kind: 'file', risk: true });
  });
});

describe('analyzeLayer — doc-stack grouping (docs/planning/ROADMAP-V2.md v2.0.1)', () => {
  it('collapses more than one doc-extension file at a layer into ONE docstack item', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'doc-stack-test' }));
    writeText(resolve(root, 'README.md'), '# readme');
    writeText(resolve(root, 'CONTRIBUTING.md'), '# contributing');
    writeText(resolve(root, 'notes.txt'), 'notes');
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: root, cacheDir });

    const result = await analyzeLayer({ rootDir: root, cacheDir, layerPath: '' });
    const docStacks = result?.items.filter((i) => i.kind === 'docstack') ?? [];
    expect(docStacks).toHaveLength(1);
    expect(docStacks[0]?.files.map((f) => f.name).sort()).toEqual(['CONTRIBUTING.md', 'README.md', 'notes.txt']);
    // The 3 doc files are gone as individual file items — only the one stack represents them.
    expect(result?.items.some((i) => i.kind === 'file' && (i.name === 'README.md' || i.name === 'CONTRIBUTING.md' || i.name === 'notes.txt'))).toBe(
      false,
    );
  });

  it('leaves a SINGLE loose doc file as an ordinary file item, not a one-item stack', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'doc-stack-test' }));
    writeText(resolve(root, 'README.md'), '# readme');
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: root, cacheDir });

    const result = await analyzeLayer({ rootDir: root, cacheDir, layerPath: '' });
    expect(result?.items.some((i) => i.kind === 'docstack')).toBe(false);
    expect(result?.items.find((i) => i.kind === 'file' && i.name === 'README.md')).toBeDefined();
  });

  it('never groups a real source file, even one with zero import edges, as a doc', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'doc-stack-test' }));
    writeText(resolve(root, 'README.md'), '# readme');
    writeText(resolve(root, 'CHANGELOG.md'), '# changelog');
    // A genuinely isolated real source file — zero imports, zero importers — must stay its own
    // file item, never swept into the docs bucket just for having no edges (ROADMAP-V2.md's
    // own "why extension-only, not zero import edges" reasoning).
    writeText(resolve(root, 'standalone.ts'), 'export const isolated = true;\n');
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: root, cacheDir });

    const result = await analyzeLayer({ rootDir: root, cacheDir, layerPath: '' });
    const byId = Object.fromEntries((result?.items ?? []).map((i) => [i.id, i]));
    expect(byId['standalone.ts']).toMatchObject({ kind: 'file', name: 'standalone.ts' });
    const docStack = result?.items.find((i) => i.kind === 'docstack');
    expect(docStack?.files.map((f) => f.name).sort()).toEqual(['CHANGELOG.md', 'README.md']);
  });

  it('groups doc files at a deeper layer the same way, keyed to that exact layer path', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'doc-stack-test' }));
    writeText(resolve(root, 'docs/architecture.md'), '# architecture');
    writeText(resolve(root, 'docs/decisions.md'), '# decisions');
    writeText(resolve(root, 'docs/principles.md'), '# principles');
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: root, cacheDir });

    const result = await analyzeLayer({ rootDir: root, cacheDir, layerPath: 'docs' });
    const docStack = result?.items.find((i) => i.kind === 'docstack');
    expect(docStack?.id).toBe('docs/(docstack)');
    expect(docStack?.files).toHaveLength(3);
  });

  it('is case-insensitive on the extension (.MD counts as a doc file)', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'doc-stack-test' }));
    writeText(resolve(root, 'README.MD'), '# readme');
    writeText(resolve(root, 'NOTES.Md'), '# notes');
    const cacheDir = createTempCacheDir();
    await analyze({ rootDir: root, cacheDir });

    const result = await analyzeLayer({ rootDir: root, cacheDir, layerPath: '' });
    expect(result?.items.find((i) => i.kind === 'docstack')?.files).toHaveLength(2);
  });
});
