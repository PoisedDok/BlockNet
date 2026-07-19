import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { derivePills } from '../src/blocks/pills.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-pills-test-'));
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

describe('derivePills', () => {
  it('reflects real runtime deps from the block\'s own package.json', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/a/package.json'), {
      name: 'a',
      dependencies: { react: '^18.0.0', pg: '^8.11.0' },
    });

    expect(derivePills(resolve(root, 'packages/a'), root)).toEqual(['pg', 'react']);
  });

  it('includes devDependencies alongside dependencies, deduplicated and sorted', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'apps/web/package.json'), {
      name: 'web',
      dependencies: { react: '^18.0.0' },
      devDependencies: { tailwindcss: '^3.0.0', react: '^18.0.0' },
    });

    expect(derivePills(resolve(root, 'apps/web'), root)).toEqual(['react', 'tailwindcss']);
  });

  it('falls back to the repo root package.json when the block has none of its own', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', dependencies: { express: '^4.18.0' } });
    mkdirSync(resolve(root, 'src/auth'), { recursive: true });

    expect(derivePills(resolve(root, 'src/auth'), root)).toEqual(['express']);
  });

  it('does NOT fall back to root when the block\'s own package.json exists but is malformed — ' +
    'misattributing an unrelated project\'s stack is worse than showing none', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', dependencies: { express: '^4.18.0' } });
    writeText(resolve(root, 'packages/a/package.json'), '{ not valid json');

    expect(derivePills(resolve(root, 'packages/a'), root)).toEqual([]);
  });

  it('does NOT fall back to root for a block that owns a different language\'s manifest ' +
    '(e.g. a Python pyproject.toml, no package.json) — the root\'s JS deps are not this ' +
    'block\'s tech stack', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', dependencies: { express: '^4.18.0' } });
    writeText(resolve(root, 'backend/pyproject.toml'), '[project]\nname = "backend"\n');

    expect(derivePills(resolve(root, 'backend'), root)).toEqual([]);
  });

  it('returns an empty array when neither the block nor the root has a package.json', () => {
    const root = createTempRepo();
    mkdirSync(resolve(root, 'src/auth'), { recursive: true });

    expect(derivePills(resolve(root, 'src/auth'), root)).toEqual([]);
  });

  it('returns an empty array when package.json exists but declares no dependencies', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/a/package.json'), { name: 'a' });

    expect(derivePills(resolve(root, 'packages/a'), root)).toEqual([]);
  });

  it('returns an empty array instead of index-key garbage when `dependencies` is malformed as an array', () => {
    const root = createTempRepo();
    // A corrupted merge / bad codegen — dependencies ends up an array, not an object.
    // Object.keys() on an array yields ['0','1'], which would otherwise surface as fake
    // pills "0", "1" — a silent truth violation, not a crash.
    writeJson(resolve(root, 'packages/a/package.json'), { name: 'a', dependencies: ['react', 'pg'] });

    expect(derivePills(resolve(root, 'packages/a'), root)).toEqual([]);
  });

  it('returns an empty array instead of index-key garbage when `dependencies` is malformed as a string', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'packages/a/package.json'), { name: 'a', dependencies: 'react' });

    expect(derivePills(resolve(root, 'packages/a'), root)).toEqual([]);
  });

  it('reads directly from the root package.json when the block IS the repo root', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', dependencies: { express: '^4.18.0' } });

    expect(derivePills(root, root)).toEqual(['express']);
  });
});
