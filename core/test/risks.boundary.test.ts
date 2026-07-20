import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findBoundaryViolations } from '../src/risks/boundary.js';
import type { BlockNode, FileEdge } from '../src/types.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-boundary-test-'));
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

function block(id: string, path: string): BlockNode {
  return { id, name: id, path, pills: [], fileCount: 0, riskCount: 0 };
}

function fileEdge(sourceFile: string, targetFile: string, line = 1): FileEdge {
  return { sourceFile, targetFile, line, statement: `import from '${targetFile}'` };
}

describe('findBoundaryViolations — no exports, no main (conventional index fallback)', () => {
  it('does NOT flag an import of packages/c/src/index.ts when c has no package.json ' +
    'main/exports field at all — the real fixture shape this rule was built for', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), { name: 'c' });
    writeText(resolve(root, 'packages/c/src/index.ts'), 'export const x = 1;\n');
    const blocks = [block('packages/c', 'packages/c')];

    const edge = fileEdge('packages/b/src/index.ts', 'packages/c/src/index.ts');
    expect(findBoundaryViolations([edge], blocks, root)).toEqual([]);
  });

  it('DOES flag a deep import into an internal file when the target has no exports/main ' +
    '(the "declared entry" is only its own conventional index)', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), { name: 'c' });
    writeText(resolve(root, 'packages/c/src/index.ts'), 'export const x = 1;\n');
    writeText(resolve(root, 'packages/c/src/internal.ts'), 'export const y = 42;\n');
    const blocks = [block('packages/c', 'packages/c')];

    const edge = fileEdge('packages/a/src/index.ts', 'packages/c/src/internal.ts');
    expect(findBoundaryViolations([edge], blocks, root)).toEqual([edge]);
  });

  it('resolves a block-root index.ts (no src/ nesting) as the declared entry too', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/flat/package.json'), { name: 'flat' });
    writeText(resolve(root, 'packages/flat/index.ts'), 'export const x = 1;\n');
    const blocks = [block('packages/flat', 'packages/flat')];

    const edge = fileEdge('packages/a/src/index.ts', 'packages/flat/index.ts');
    expect(findBoundaryViolations([edge], blocks, root)).toEqual([]);
  });
});

describe('findBoundaryViolations — package.json main field', () => {
  it('treats the resolved main file as the sole declared entry', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), { name: 'c', main: './src/index.ts' });
    writeText(resolve(root, 'packages/c/src/index.ts'), 'export const x = 1;\n');
    writeText(resolve(root, 'packages/c/src/other.ts'), 'export const y = 1;\n');
    const blocks = [block('packages/c', 'packages/c')];

    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/src/index.ts')], blocks, root)).toEqual([]);
    const violation = fileEdge('a.ts', 'packages/c/src/other.ts');
    expect(findBoundaryViolations([violation], blocks, root)).toEqual([violation]);
  });

  it('resolves main pointing at built .js output back to its real .ts source on disk', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), { name: 'c', main: './dist/index.js' });
    // Unbuilt monorepo: dist/ doesn't exist yet, only the TS source does — dependency-cruiser
    // resolves specifiers the same way (docs/decisions/0003's tsPreCompilationDeps), so the
    // declared-entry resolution must match, not require a build step to have run.
    writeText(resolve(root, 'packages/c/dist/index.ts'), 'export const x = 1;\n');
    const blocks = [block('packages/c', 'packages/c')];

    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/dist/index.ts')], blocks, root)).toEqual([]);
  });

  it('resolves a .mts/.cts declared entry — dependency-cruiser parses both as TS-compatible ' +
    '(tsPreCompilationDeps), and a native-ESM/CJS-TS package declaring one is a real, not ' +
    'exotic, pattern (e.g. a vite.config.mts-style package)', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), { name: 'c', main: './index.mts' });
    writeText(resolve(root, 'packages/c/index.mts'), 'export const x = 1;\n');
    writeText(resolve(root, 'packages/c/internal.cts'), 'export const y = 1;\n');
    const blocks = [block('packages/c', 'packages/c')];

    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/index.mts')], blocks, root)).toEqual([]);
    const violation = fileEdge('a.ts', 'packages/c/internal.cts');
    expect(findBoundaryViolations([violation], blocks, root)).toEqual([violation]);
  });
});

describe('findBoundaryViolations — package.json exports map', () => {
  it('accepts every declared subpath, not just "."', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), {
      name: 'c',
      exports: { '.': './src/index.ts', './utils': './src/utils.ts' },
    });
    writeText(resolve(root, 'packages/c/src/index.ts'), 'export {};\n');
    writeText(resolve(root, 'packages/c/src/utils.ts'), 'export {};\n');
    writeText(resolve(root, 'packages/c/src/internal.ts'), 'export {};\n');
    const blocks = [block('packages/c', 'packages/c')];

    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/src/index.ts')], blocks, root)).toEqual([]);
    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/src/utils.ts')], blocks, root)).toEqual([]);
    const violation = fileEdge('a.ts', 'packages/c/src/internal.ts');
    expect(findBoundaryViolations([violation], blocks, root)).toEqual([violation]);
  });

  it('accepts an import matching a wildcard subpath ("./*": "./src/*.ts") — a common real ' +
    'pattern for intentionally exposing an entire subtree, not just named subpaths', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), {
      name: 'c',
      exports: { '.': './src/index.ts', './*': './src/*.ts' },
    });
    writeText(resolve(root, 'packages/c/src/index.ts'), 'export {};\n');
    writeText(resolve(root, 'packages/c/src/utils.ts'), 'export {};\n');
    writeText(resolve(root, 'packages/c/src/features/x.ts'), 'export {};\n');
    const blocks = [block('packages/c', 'packages/c')];

    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/src/utils.ts')], blocks, root)).toEqual([]);
    // Node's exports wildcard matches one-or-more path segments, including nested ones.
    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/src/features/x.ts')], blocks, root)).toEqual([]);
  });

  it('still flags a path that does NOT match any declared wildcard pattern', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), {
      name: 'c',
      exports: { '.': './src/index.ts', './*': './src/*.ts' },
    });
    writeText(resolve(root, 'packages/c/src/index.ts'), 'export {};\n');
    writeText(resolve(root, 'packages/c/other/secret.ts'), 'export {};\n');
    const blocks = [block('packages/c', 'packages/c')];

    const violation = fileEdge('a.ts', 'packages/c/other/secret.ts');
    expect(findBoundaryViolations([violation], blocks, root)).toEqual([violation]);
  });

  it('flattens nested conditional export objects (import/require/types) to their leaf paths', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), {
      name: 'c',
      exports: { '.': { import: './src/esm.ts', require: './src/cjs.ts' } },
    });
    writeText(resolve(root, 'packages/c/src/esm.ts'), 'export {};\n');
    writeText(resolve(root, 'packages/c/src/cjs.ts'), 'export {};\n');
    const blocks = [block('packages/c', 'packages/c')];

    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/src/esm.ts')], blocks, root)).toEqual([]);
    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/src/cjs.ts')], blocks, root)).toEqual([]);
  });

  it('ignores main entirely once exports is present, per Node module resolution semantics', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), {
      name: 'c',
      main: './src/legacy.ts',
      exports: './src/index.ts',
    });
    writeText(resolve(root, 'packages/c/src/legacy.ts'), 'export {};\n');
    writeText(resolve(root, 'packages/c/src/index.ts'), 'export {};\n');
    const blocks = [block('packages/c', 'packages/c')];

    // main's target is no longer a declared entry once exports exists.
    const violation = fileEdge('a.ts', 'packages/c/src/legacy.ts');
    expect(findBoundaryViolations([violation], blocks, root)).toEqual([violation]);
    expect(findBoundaryViolations([fileEdge('a.ts', 'packages/c/src/index.ts')], blocks, root)).toEqual([]);
  });
});

describe('findBoundaryViolations — flat-fallback blocks have no declared-entry concept', () => {
  it('never flags a deep import into a block that owns no package.json of its own — a ' +
    'flat-fallback block (top-level folder under src/, no manifest at all) is a directory ' +
    'grouping, not a package with a designed public surface, confirmed as a real false ' +
    'positive against aetherinc\'s src/lib (every one of its 47+53 real imports got flagged ' +
    'before this fix, a 100% false-positive rate on a Checkpoint-A real repo)', () => {
    const root = createTempRepo();
    // No package.json anywhere under src/lib — matches flat-fallback's actual real-world shape.
    writeText(resolve(root, 'src/lib/utils.ts'), 'export const x = 1;\n');
    writeText(resolve(root, 'src/app/page.tsx'), 'export {};\n');
    const blocks = [block('src/app', 'src/app'), block('src/lib', 'src/lib')];

    const edge = fileEdge('src/app/page.tsx', 'src/lib/utils.ts');
    expect(findBoundaryViolations([edge], blocks, root)).toEqual([]);
  });

  it('still flags a deep import into a block that DOES own a package.json, even an empty one', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), { name: 'c' });
    writeText(resolve(root, 'packages/c/src/index.ts'), 'export {};\n');
    writeText(resolve(root, 'packages/c/src/internal.ts'), 'export {};\n');
    const blocks = [block('packages/c', 'packages/c')];

    const edge = fileEdge('a.ts', 'packages/c/src/internal.ts');
    expect(findBoundaryViolations([edge], blocks, root)).toEqual([edge]);
  });
});

describe('findBoundaryViolations — scope', () => {
  it('does not flag an intra-block deep import — boundary only applies across blocks', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/c/package.json'), { name: 'c' });
    writeText(resolve(root, 'packages/c/src/index.ts'), 'export {};\n');
    writeText(resolve(root, 'packages/c/src/internal.ts'), 'export {};\n');
    const blocks = [block('packages/c', 'packages/c')];

    const edge = fileEdge('packages/c/src/index.ts', 'packages/c/src/internal.ts');
    expect(findBoundaryViolations([edge], blocks, root)).toEqual([]);
  });

  it('never flags an import whose target resolves to the synthetic (root) block — root has no declared public surface', () => {
    const root = createTempRepo();
    const blocks = [block('packages/a', 'packages/a')];

    const edge = fileEdge('packages/a/src/index.ts', 'scripts/build.ts');
    expect(findBoundaryViolations([edge], blocks, root)).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    const root = createTempRepo();
    expect(findBoundaryViolations([], [block('packages/a', 'packages/a')], root)).toEqual([]);
  });
});

describe('findBoundaryViolations — real monorepo fixture wiring', () => {
  it('reproduces the exact deep-import violation the fixture was built for: a -> c/src/internal.ts', () => {
    const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');
    const blocks = [block('packages/a', 'packages/a'), block('packages/b', 'packages/b'), block('packages/c', 'packages/c')];

    const deepImport = fileEdge('packages/a/src/index.ts', 'packages/c/src/internal.ts');
    const entryImport = fileEdge('packages/b/src/internal.ts', 'packages/c/src/index.ts');
    expect(findBoundaryViolations([deepImport, entryImport], blocks, fixture)).toEqual([deepImport]);
  });
});

describe('findBoundaryViolations — unknown target block id', () => {
  it('does not flag when resolveBlock somehow yields a block id absent from the blocks list (defensive)', () => {
    const root = createTempRepo();
    // No blocks at all — every file resolves to ROOT_BLOCK_ID, already excluded above, so this
    // just re-confirms the empty-blocks-list path degrades to "no violations", not a crash.
    const edge = fileEdge('a.ts', 'b.ts');
    expect(() => findBoundaryViolations([edge], [], root)).not.toThrow();
    expect(findBoundaryViolations([edge], [], root)).toEqual([]);
  });
});
