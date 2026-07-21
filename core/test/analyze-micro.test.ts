import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { analyzeMicroBlock } from '../src/analyze-micro.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-analyze-micro-test-'));
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

describe('analyzeMicroBlock — checked-in monorepo fixture (cross-block risk)', () => {
  const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');

  it('returns undefined when no cache exists yet for this cacheDir', async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), 'blocknet-micro-nocache-'));
    tempDirs.push(cacheDir);
    const result = await analyzeMicroBlock({ rootDir: fixture, cacheDir, blockId: 'packages/a' });
    expect(result).toBeUndefined();
  });

  it('returns undefined for a blockId absent from the cached snapshot', async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), 'blocknet-micro-cache-'));
    tempDirs.push(cacheDir);
    await analyze({ rootDir: fixture, cacheDir });

    const result = await analyzeMicroBlock({ rootDir: fixture, cacheDir, blockId: 'packages/does-not-exist' });
    expect(result).toBeUndefined();
  });

  it('lists a block\'s real files with real LOC, and flags the file that made the BOUNDARY import as risky', async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), 'blocknet-micro-cache-'));
    tempDirs.push(cacheDir);
    await analyze({ rootDir: fixture, cacheDir });

    const result = await analyzeMicroBlock({ rootDir: fixture, cacheDir, blockId: 'packages/a' });
    expect(result?.blockId).toBe('packages/a');

    const byId = Object.fromEntries((result?.files ?? []).map((f) => [f.id, f]));
    expect(Object.keys(byId).sort()).toEqual(['packages/a/package.json', 'packages/a/src/helpers.ts', 'packages/a/src/index.ts']);
    expect(byId['packages/a/src/helpers.ts']).toMatchObject({ name: 'helpers.ts', loc: 3, risk: false });
    // packages/a/src/index.ts is the file whose own import statement made the BOUNDARY
    // violation (analyze.risks.test.ts: risk.source === 'packages/a', evidence.file ===
    // 'packages/a/src/index.ts') — real, evidence-backed, not a guess at the target side.
    expect(byId['packages/a/src/index.ts']).toMatchObject({ name: 'index.ts', risk: true });
  });

  it('includes the real intra-block edge (index.ts -> helpers.ts) as non-risky', async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), 'blocknet-micro-cache-'));
    tempDirs.push(cacheDir);
    await analyze({ rootDir: fixture, cacheDir });

    const result = await analyzeMicroBlock({ rootDir: fixture, cacheDir, blockId: 'packages/a' });
    expect(result?.edges).toEqual([
      { id: 'packages/a/src/index.ts->packages/a/src/helpers.ts', source: 'packages/a/src/index.ts', target: 'packages/a/src/helpers.ts', risk: false },
    ]);
  });

  it('never includes a cross-block file in a block\'s file list', async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), 'blocknet-micro-cache-'));
    tempDirs.push(cacheDir);
    await analyze({ rootDir: fixture, cacheDir });

    const result = await analyzeMicroBlock({ rootDir: fixture, cacheDir, blockId: 'packages/b' });
    expect((result?.files ?? []).some((f) => f.id.startsWith('packages/c/'))).toBe(false);
  });
});

describe('analyzeMicroBlock — intra-block cycle (the deliberate v1 scope boundary this closes)', () => {
  it('flags both files and the edge of a cycle entirely within one block as risky', async () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'intra-cycle-repo' });
    writeText(resolve(root, 'src/pkgA/one.ts'), "import { two } from './two.js';\nexport const one = two;\n");
    writeText(resolve(root, 'src/pkgA/two.ts'), "import { one } from './one.js';\nexport const two = 1;\n");
    const cacheDir = resolve(root, '.cache');
    await analyze({ rootDir: root, cacheDir });

    const result = await analyzeMicroBlock({ rootDir: root, cacheDir, blockId: 'src/pkgA' });
    const byId = Object.fromEntries((result?.files ?? []).map((f) => [f.id, f]));
    expect(byId['src/pkgA/one.ts']?.risk).toBe(true);
    expect(byId['src/pkgA/two.ts']?.risk).toBe(true);

    expect(result?.edges).toHaveLength(2);
    expect(result?.edges.every((e) => e.risk)).toBe(true);

    // This exact cycle is invisible at block level — risks/index.ts deliberately excludes
    // it (it never crosses a block boundary) — confirming this really is new, micro-only
    // territory, not a duplicate of an existing macro-level risk.
    const macro = await analyze({ rootDir: root, cacheDir: resolve(root, '.cache2') });
    expect(macro.risks).toEqual([]);
  });

  it('does not flag an unrelated file in the same block that has no part in the cycle', async () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'intra-cycle-repo' });
    writeText(resolve(root, 'src/pkgA/one.ts'), "import { two } from './two.js';\nexport const one = two;\n");
    writeText(resolve(root, 'src/pkgA/two.ts'), "import { one } from './one.js';\nexport const two = 1;\n");
    writeText(resolve(root, 'src/pkgA/quiet.ts'), 'export const quiet = 1;\n');
    const cacheDir = resolve(root, '.cache');
    await analyze({ rootDir: root, cacheDir });

    const result = await analyzeMicroBlock({ rootDir: root, cacheDir, blockId: 'src/pkgA' });
    const byId = Object.fromEntries((result?.files ?? []).map((f) => [f.id, f]));
    expect(byId['src/pkgA/quiet.ts']?.risk).toBe(false);
  });
});

describe('analyzeMicroBlock — nested blocks (a block whose path is a subdirectory of another block\'s path)', () => {
  it('does not include a nested block\'s own files in its parent block\'s file list', async () => {
    const root = createTempRepo();
    // Mirrors this repo's own real shape: root workspaces = ["outer", "outer/inner"] — npm
    // workspaces legitimately nest a member's path inside another member's path. Found via
    // real-repo verification against BlockNet analyzing itself: analyzeMicroBlock('extension')
    // returned 80 files when block.fileCount said 24 — exactly 24 + extension/webview's 56,
    // because filesForBlock's non-root branch walked the whole subdirectory instead of
    // resolving each file through resolveBlock() the way computeBlockShape() (analyze.ts) and
    // the root-block branch already do.
    writeJson(resolve(root, 'package.json'), { name: 'nested-workspace-repo', workspaces: ['outer', 'outer/inner'] });
    writeJson(resolve(root, 'outer/package.json'), { name: 'outer' });
    writeText(resolve(root, 'outer/own.ts'), 'export const own = 1;\n');
    writeJson(resolve(root, 'outer/inner/package.json'), { name: 'inner' });
    writeText(resolve(root, 'outer/inner/nested.ts'), 'export const nested = 1;\n');
    const cacheDir = resolve(root, '.cache');
    const macro = await analyze({ rootDir: root, cacheDir });
    const outerBlock = macro.blocks.find((b) => b.id === 'outer');
    expect(outerBlock?.fileCount).toBe(2); // package.json + own.ts, NOT inner/'s files

    const result = await analyzeMicroBlock({ rootDir: root, cacheDir, blockId: 'outer' });
    const ids = (result?.files ?? []).map((f) => f.id).sort();
    expect(ids).toEqual(['outer/own.ts', 'outer/package.json']);
    expect(ids.some((id) => id.startsWith('outer/inner/'))).toBe(false);
  });

  it('matches the authoritative fileCount even when a physical file is symlinked into a different block (cross-block dedup)', async () => {
    // Found by the architectural-soundness review lane on the fix above: computeBlockShape()
    // (analyze.ts) tallies fileCount from ONE walkRealFiles(rootDir) call sharing ONE real-path
    // dedup instance for the whole tree (file-walk.ts) — a physical file reachable via two
    // symlinked paths in two different blocks' directories (a real Nx/Bazel-style tooling
    // pattern) is credited to whichever block's path the walk visits first, and skipped
    // everywhere else. The (now-fixed) non-root branch of filesForBlock called
    // walkRealFiles(join(rootDir, block.path)) per block — a FRESH dedup instance scoped only
    // to that one subdirectory, with zero visibility into what the whole-tree walk already
    // claimed elsewhere — so a block whose own directory holds a symlink to a file physically
    // owned by another block would still list it, even though block.fileCount (computed from
    // the shared whole-tree walk) does not count it there. Fixed by making filesForBlock do the
    // identical single whole-tree walk + resolveBlock filter computeBlockShape() itself uses,
    // for every block including root — no more scoped-subdirectory branch to diverge.
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'cross-block-symlink-repo', workspaces: ['blockA', 'blockB'] });
    writeJson(resolve(root, 'blockA/package.json'), { name: 'blockA' });
    writeText(resolve(root, 'blockA/real/file1.ts'), 'export const shared = 1;\n');
    writeJson(resolve(root, 'blockB/package.json'), { name: 'blockB' });
    symlinkSync(resolve(root, 'blockA/real/file1.ts'), resolve(root, 'blockB/link-to-file1.ts'), 'file');
    const cacheDir = resolve(root, '.cache');
    const macro = await analyze({ rootDir: root, cacheDir });

    for (const blockId of ['blockA', 'blockB']) {
      const block = macro.blocks.find((b) => b.id === blockId);
      const result = await analyzeMicroBlock({ rootDir: root, cacheDir, blockId });
      expect(result?.files.length).toBe(block?.fileCount);
    }
  });
});

describe('analyzeMicroBlock — large/binary files never get fully read for a LOC count', () => {
  it('degrades to loc: 0 for a large file instead of reading it fully into memory', async () => {
    // Found via real-repo verification against aetherinc: a 528MB tar.gz checked into the repo
    // root made the "(root)" block's micro request take 2-3 seconds (vs ~150ms for a
    // similarly-sized block with no such file) — countLines() unconditionally read every file
    // as UTF-8 text and split it on newlines, regardless of size or content. A double-click is
    // supposed to be cheap "regardless of repo size" (this file's own header comment) — a
    // single large binary blowing that up by 10x+ is a real bug, not a documented tradeoff.
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'large-file-repo' });
    writeText(resolve(root, 'src/pkgA/huge.bin'), 'x'.repeat(3 * 1024 * 1024)); // 3MB, no newlines
    writeText(resolve(root, 'src/pkgA/normal.ts'), 'export const a = 1;\nexport const b = 2;\n');
    const cacheDir = resolve(root, '.cache');
    await analyze({ rootDir: root, cacheDir });

    const result = await analyzeMicroBlock({ rootDir: root, cacheDir, blockId: 'src/pkgA' });
    const byId = Object.fromEntries((result?.files ?? []).map((f) => [f.id, f]));
    expect(byId['src/pkgA/huge.bin']?.loc).toBe(0);
    expect(byId['src/pkgA/normal.ts']?.loc).toBe(2);
  });
});

describe('analyzeMicroBlock — the synthetic "(root)" catch-all block', () => {
  it('lists exactly the files no detected block claims, not the whole repo', async () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root-fallback-repo' });
    writeText(resolve(root, 'apps/web/package.json'), JSON.stringify({ name: 'web' }));
    writeText(resolve(root, 'apps/web/src/index.ts'), 'export const w = 1;\n');
    writeText(resolve(root, 'loose-script.ts'), 'export const loose = 1;\n');
    const cacheDir = resolve(root, '.cache');
    await analyze({ rootDir: root, cacheDir });

    const result = await analyzeMicroBlock({ rootDir: root, cacheDir, blockId: '(root)' });
    const ids = (result?.files ?? []).map((f) => f.id).sort();
    expect(ids).toContain('loose-script.ts');
    expect(ids).toContain('package.json');
    expect(ids.some((id) => id.startsWith('apps/web/'))).toBe(false);
  });
});
