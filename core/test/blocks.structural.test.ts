import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectStructuralBlocks } from '../src/blocks/structural.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-structural-test-'));
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

function writePackageJson(root: string, relativeDir: string) {
  mkdirSync(resolve(root, relativeDir), { recursive: true });
  writeFileSync(resolve(root, relativeDir, 'package.json'), JSON.stringify({ name: relativeDir }));
}

describe('detectStructuralBlocks — generic host-detection walk, no hardcoded folder vocabulary', () => {
  it('produces one block per top-level directory that owns a package.json, whatever it is named', () => {
    const root = createTempRepo();
    writePackageJson(root, 'frontend');
    writePackageJson(root, 'backend');
    writePackageJson(root, 'some-oddly-named-thing');

    const blocks = detectStructuralBlocks(root);
    expect(blocks.map((b) => b.path).sort()).toEqual(['backend', 'frontend', 'some-oddly-named-thing']);
  });

  it('recurses into a non-host container one level to find a host underneath it', () => {
    const root = createTempRepo();
    writePackageJson(root, 'team-x/service-a');
    mkdirs(root, 'docs/guides');

    const blocks = detectStructuralBlocks(root);
    expect(blocks).toEqual([{ name: 'service-a', path: 'team-x/service-a' }]);
  });

  it('stops recursing once a host is found — a nested package.json inside a host is not a separate block', () => {
    const root = createTempRepo();
    writePackageJson(root, 'proj');
    writePackageJson(root, 'proj/nested-tool');

    const blocks = detectStructuralBlocks(root);
    expect(blocks).toEqual([{ name: 'proj', path: 'proj' }]);
  });

  it('resolves hosts at different depths within the same repo (real AetherArenaV2 shape)', () => {
    const root = createTempRepo();
    writePackageJson(root, 'frontend');
    writePackageJson(root, 'backend/packages/harness');
    mkdirs(root, 'docs');

    const blocks = detectStructuralBlocks(root);
    expect(blocks.map((b) => b.path).sort()).toEqual(['backend/packages/harness', 'frontend']);
  });

  it('finds a host exactly at the depth cap (4 levels below root)', () => {
    const root = createTempRepo();
    writePackageJson(root, 'a/b/c/d');

    const blocks = detectStructuralBlocks(root);
    expect(blocks).toEqual([{ name: 'd', path: 'a/b/c/d' }]);
  });

  it('gives up on a branch one level beyond the depth cap', () => {
    const root = createTempRepo();
    writePackageJson(root, 'a/b/c/d/e');

    expect(detectStructuralBlocks(root)).toEqual([]);
  });

  it('ignores dot-directories and node_modules while searching for hosts', () => {
    const root = createTempRepo();
    writePackageJson(root, '.hidden');
    writePackageJson(root, 'node_modules/some-dep');
    writePackageJson(root, 'real-app');

    const blocks = detectStructuralBlocks(root);
    expect(blocks).toEqual([{ name: 'real-app', path: 'real-app' }]);
  });

  it('does not mistake a package.json vendored inside a build/dependency-output directory ' +
    'for a real project — a real bug found after the multi-language work only widened ' +
    'the exclude pattern for fileCount/edges, not this directory-listing traversal', () => {
    const root = createTempRepo();
    writePackageJson(root, 'vendor/some-composer-asset-pipeline');
    writePackageJson(root, 'dist/some-npm-pack-output');
    writePackageJson(root, 'target/pkg'); // e.g. wasm-pack's target/pkg/package.json
    writePackageJson(root, 'real-app');

    const blocks = detectStructuralBlocks(root);
    expect(blocks).toEqual([{ name: 'real-app', path: 'real-app' }]);
  });

  it('follows a symlinked host directory instead of silently dropping it', () => {
    const root = createTempRepo();
    // Real target lives under node_modules (pnpm/Nx-style linking) so it is NOT
    // independently discoverable as its own top-level candidate — the only path the walk
    // can reach it through is the symlink, isolating what this test actually checks.
    writePackageJson(root, 'node_modules/.store/real-service');
    mkdirSync(resolve(root, 'services'), { recursive: true });
    symlinkSync(resolve(root, 'node_modules/.store/real-service'), resolve(root, 'services/gateway'), 'dir');

    const blocks = detectStructuralBlocks(root);
    expect(blocks).toEqual([{ name: 'gateway', path: 'services/gateway' }]);
  });

  it('ignores a file sitting where a candidate directory would be', () => {
    const root = createTempRepo();
    mkdirs(root, 'frontend');
    writeFileSync(resolve(root, 'frontend/package.json'), '{}');
    writeFileSync(resolve(root, 'a-plain-file.ts'), 'export {};');

    const blocks = detectStructuralBlocks(root);
    expect(blocks).toEqual([{ name: 'frontend', path: 'frontend' }]);
  });

  it('does NOT recognize a non-JS manifest (e.g. pyproject.toml) as a host — that\'s ' +
    'other-languages.ts\'s job, additively, not this recursive strategy\'s (a second ' +
    'Checkpoint A finding: recognizing it here let one incidental non-JS manifest anywhere ' +
    'in the tree hijack the whole cascade)', () => {
    const root = createTempRepo();
    mkdirs(root, 'backend');
    writeFileSync(resolve(root, 'backend/pyproject.toml'), '[project]\nname = "backend"\n');

    expect(detectStructuralBlocks(root)).toEqual([]);
  });

  it('returns no candidates when nothing hosts anywhere within the depth cap', () => {
    const root = createTempRepo();
    mkdirs(root, 'src/auth', 'src/api');

    expect(detectStructuralBlocks(root)).toEqual([]);
  });

  it('returns no candidates for a completely empty repo', () => {
    const root = createTempRepo();
    expect(detectStructuralBlocks(root)).toEqual([]);
  });

  it('does not blow up combinatorially on a branching symlink cycle (real dirs a/, b/, each with ' +
    '40 symlinks pointing at the other) — depth alone does not bound cost, real-path dedup does', () => {
    const root = createTempRepo();
    const branching = 40;
    mkdirs(root, 'a', 'b');
    for (let i = 0; i < branching; i++) {
      symlinkSync(resolve(root, 'b'), resolve(root, `a/to-b-${i}`), 'dir');
      symlinkSync(resolve(root, 'a'), resolve(root, `b/to-a-${i}`), 'dir');
    }

    // Without real-path dedup this is O(branching^4) — tens of seconds for branching=40.
    // With dedup, `a` and `b` are each visited exactly once; every symlink back to an
    // already-visited real directory is skipped immediately.
    expect(detectStructuralBlocks(root)).toEqual([]);
  }, 3000);
});
