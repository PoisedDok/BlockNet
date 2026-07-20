import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDependencyCruise } from '../src/edges/depcruise-runner.js';
import { createLogger } from '../src/log.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-depcruise-test-'));
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

function depsOf(result: Awaited<ReturnType<typeof runDependencyCruise>>, source: string) {
  return result.modules.find((m) => m.source === source)?.dependencies ?? [];
}

describe('runDependencyCruise — checked-in monorepo fixture', () => {
  const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');

  it('resolves a relative import', async () => {
    const result = await runDependencyCruise(fixture);
    const deps = depsOf(result, 'packages/a/src/index.ts');
    expect(deps.some((d) => d.resolved === 'packages/a/src/helpers.ts')).toBe(true);
  });

  it('resolves a tsconfig-aliased import to another block, regardless of process.cwd()', async () => {
    const originalCwd = process.cwd();
    process.chdir(tmpdir());
    try {
      const result = await runDependencyCruise(fixture);
      const deps = depsOf(result, 'packages/a/src/index.ts');
      expect(deps.some((d) => d.resolved === 'packages/c/src/internal.ts')).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('resolves a barrel import to the barrel file itself, not the re-exported internal file', async () => {
    const result = await runDependencyCruise(fixture);
    const deps = depsOf(result, 'packages/c/src/index.ts');
    expect(deps.some((d) => d.resolved === 'packages/b/src/index.ts')).toBe(true);
  });

  it('excludes node_modules from the module graph entirely', async () => {
    const result = await runDependencyCruise(fixture);
    expect(result.modules.every((m) => !m.source.includes('node_modules'))).toBe(true);
  });
});

describe('runDependencyCruise — scoped entry files (cache/invalidate.ts\'s delta path)', () => {
  const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');

  it('when given specific entry files, still resolves that file\'s own real dependency correctly', async () => {
    const result = await runDependencyCruise(fixture, createLogger(), ['packages/b/src/index.ts']);
    const deps = depsOf(result, 'packages/b/src/index.ts');
    expect(deps.some((d) => d.resolved === 'packages/b/src/internal.ts')).toBe(true);
  });

  it('scoped to one entry file finds strictly fewer (or equal) modules than a full cruise of the whole fixture', async () => {
    const full = await runDependencyCruise(fixture);
    const scoped = await runDependencyCruise(fixture, createLogger(), ['packages/b/src/index.ts']);
    expect(scoped.modules.length).toBeLessThan(full.modules.length);
  });
});

describe('runDependencyCruise — build-output dot-directories', () => {
  it('excludes .next (and other dot-directories) even though they are not literally named dist/build/out/coverage', async () => {
    const dir = createTempRepo();
    writeText(resolve(dir, 'src/main.ts'), "import { b } from './b.js';\nconsole.log(b);\n");
    writeText(resolve(dir, 'src/b.ts'), 'export const b = 1;\n');
    // A real Next.js build writes thousands of generated .js files here — none of them are
    // source, and none should ever reach the module graph.
    writeText(resolve(dir, '.next/server/generated.js'), 'module.exports = {};\n');

    const result = await runDependencyCruise(dir);
    expect(result.modules.some((m) => m.source.startsWith('.next/'))).toBe(false);
  });
});

describe('runDependencyCruise — non-JS build/dependency output directories', () => {
  it('excludes target/__pycache__/venv/vendor from the import scan itself, not just fileCount ' +
    '— path-utils.ts\'s EXCLUDE_PATTERN_SOURCE is shared with file-walk.ts, so this widening ' +
    'reaches the actual dependency-cruiser call too', async () => {
    const dir = createTempRepo();
    writeText(resolve(dir, 'src/main.ts'), "import { b } from './b.js';\nconsole.log(b);\n");
    writeText(resolve(dir, 'src/b.ts'), 'export const b = 1;\n');
    writeText(resolve(dir, 'target/pkg/generated.js'), 'module.exports = {};\n');
    writeText(resolve(dir, 'vendor/some-lib/generated.js'), 'module.exports = {};\n');

    const result = await runDependencyCruise(dir);
    expect(result.modules.some((m) => m.source.startsWith('target/'))).toBe(false);
    expect(result.modules.some((m) => m.source.startsWith('vendor/'))).toBe(false);
  });
});

describe('runDependencyCruise — unused-import elision', () => {
  it('still reports an import that is never referenced in the importing file', async () => {
    const dir = createTempRepo();
    writeText(resolve(dir, 'src/main.ts'), "import { unused } from './other.js';\n");
    writeText(resolve(dir, 'src/other.ts'), 'export const unused = 1;\n');

    const result = await runDependencyCruise(dir);
    const deps = depsOf(result, 'src/main.ts');
    expect(deps.some((d) => d.resolved === 'src/other.ts')).toBe(true);
  });
});

describe('runDependencyCruise — no tsconfig.json present', () => {
  it('does not throw, and still resolves plain relative imports', async () => {
    const dir = createTempRepo();
    writeText(resolve(dir, 'src/a.ts'), "import { b } from './b.js';\nconsole.log(b);\n");
    writeText(resolve(dir, 'src/b.ts'), 'export const b = 1;\n');

    const result = await runDependencyCruise(dir);
    const deps = depsOf(result, 'src/a.ts');
    expect(deps.some((d) => d.resolved === 'src/b.ts')).toBe(true);
  });
});

describe('runDependencyCruise — malformed tsconfig paths', () => {
  it('degrades gracefully (no throw) when a paths entry is not a single trailing "/*" pattern', async () => {
    const dir = createTempRepo();
    writeJson(resolve(dir, 'tsconfig.json'), {
      compilerOptions: { baseUrl: '.', paths: { '@exact': ['src/exact.ts'] } },
    });
    writeText(resolve(dir, 'src/a.ts'), "import { b } from './b.js';\nconsole.log(b);\n");
    writeText(resolve(dir, 'src/b.ts'), 'export const b = 1;\n');

    const result = await runDependencyCruise(dir);
    const deps = depsOf(result, 'src/a.ts');
    expect(deps.some((d) => d.resolved === 'src/b.ts')).toBe(true);
  });
});

describe('runDependencyCruise — tsconfig paths alias escaping rootDir', () => {
  it('skips an alias whose target resolves outside rootDir, and warns about it', async () => {
    const parent = createTempRepo();
    writeText(resolve(parent, 'outside/leaked.ts'), 'export const secret = 1;\n');
    const rootDir = resolve(parent, 'repo');
    writeJson(resolve(rootDir, 'tsconfig.json'), {
      compilerOptions: { baseUrl: '.', paths: { '@escape/*': ['../outside/*'] } },
    });
    writeText(
      resolve(rootDir, 'src/main.ts'),
      "import { secret } from '@escape/leaked.js';\nconsole.log(secret);\n",
    );

    const warnings: string[] = [];
    const logger = createLogger('warn', (_level, message) => warnings.push(message));

    const result = await runDependencyCruise(rootDir, logger);
    const deps = depsOf(result, 'src/main.ts');
    expect(deps.some((d) => d.couldNotResolve === false)).toBe(false);
    expect(warnings.some((w) => w.includes('resolves outside rootDir'))).toBe(true);
  });
});
