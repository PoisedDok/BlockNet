import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectOtherLanguageTopLevelBlocks } from '../src/blocks/other-languages.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-other-languages-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function mkdirs(root: string, ...relativeDirs: string[]) {
  for (const dir of relativeDirs) mkdirSync(resolve(root, dir), { recursive: true });
}

function writeFile(path: string, contents = '') {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

describe('detectOtherLanguageTopLevelBlocks — additive, shallow, non-JS-only', () => {
  it('finds a Python project (pyproject.toml at its own top level) alongside an ' +
    'already-detected JS block, matching the real AetherArenaV2 shape', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'backend/pyproject.toml'), '[project]\nname = "backend"\n');
    mkdirs(root, 'frontend');

    const existing = [{ name: 'frontend', path: 'frontend' }];
    expect(detectOtherLanguageTopLevelBlocks(root, existing)).toEqual([{ name: 'backend', path: 'backend' }]);
  });

  it('finds Go, Rust, and Docker-only top-level projects', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'service-go/go.mod'), 'module example.com/service\n');
    writeFile(resolve(root, 'service-rust/Cargo.toml'), '[package]\nname = "service"\n');
    writeFile(resolve(root, 'service-docker-only/Dockerfile'), 'FROM scratch\n');

    const found = detectOtherLanguageTopLevelBlocks(root, []);
    expect(found.map((c) => c.path).sort()).toEqual(['service-docker-only', 'service-go', 'service-rust']);
  });

  it('does NOT recurse — a manifest nested below the top level is not found, by design ' +
    '(this is what keeps one incidental deep manifest from hijacking unrelated repos)', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'project/agent-skills/red-team-skills/ct-analysis/pyproject.toml'), '');

    expect(detectOtherLanguageTopLevelBlocks(root, [])).toEqual([]);
  });

  it('skips a top-level directory already covered by an existing block\'s exact path', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'backend/pyproject.toml'), '');

    const existing = [{ name: 'backend', path: 'backend' }];
    expect(detectOtherLanguageTopLevelBlocks(root, existing)).toEqual([]);
  });

  it('skips a top-level directory that is an ANCESTOR of an existing block\'s path — ' +
    'already-claimed structure, not really "unclaimed"', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'packages/a/pyproject.toml'), '');

    const existing = [{ name: 'a', path: 'packages/a' }];
    expect(detectOtherLanguageTopLevelBlocks(root, existing)).toEqual([]);
  });

  it('does NOT confuse a sibling directory that merely shares a name PREFIX with an ' +
    'existing block (e.g. "backend" vs "backend-service") — a naive (non-slash-bounded) ' +
    'prefix check would wrongly treat one as covering the other', () => {
    const root = createTempRepo();
    writeFile(resolve(root, 'backend-service/pyproject.toml'), '');

    const existing = [{ name: 'backend', path: 'backend' }];
    expect(detectOtherLanguageTopLevelBlocks(root, existing)).toEqual([
      { name: 'backend-service', path: 'backend-service' },
    ]);
  });

  it('does not treat package.json as a qualifying manifest — that\'s the JS/TS strategies\' job', () => {
    const root = createTempRepo();
    mkdirs(root, 'frontend');
    writeFile(resolve(root, 'frontend/package.json'), '{}');

    expect(detectOtherLanguageTopLevelBlocks(root, [])).toEqual([]);
  });

  it('returns no candidates for a completely empty repo', () => {
    const root = createTempRepo();
    expect(detectOtherLanguageTopLevelBlocks(root, [])).toEqual([]);
  });
});
