import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectConventionalBlocks } from '../src/blocks/conventional.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-conventional-test-'));
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

describe('detectConventionalBlocks — apps/ packages/ services/ libs/ infra/', () => {
  it('produces one block per second-level directory across every conventional top-level folder present', () => {
    const root = createTempRepo();
    mkdirs(
      root,
      'apps/web',
      'apps/admin',
      'services/gateway',
      'services/auth',
      'infra/redis',
      'libs/shared-ui',
    );

    const blocks = detectConventionalBlocks(root);
    expect(blocks.map((b) => b.path).sort()).toEqual([
      'apps/admin',
      'apps/web',
      'infra/redis',
      'libs/shared-ui',
      'services/auth',
      'services/gateway',
    ]);
    expect(blocks.map((b) => b.name).sort()).toEqual(['admin', 'auth', 'gateway', 'redis', 'shared-ui', 'web']);
  });

  it('is not tripped up by an unrelated top-level folder that is not one of the five recognized names', () => {
    const root = createTempRepo();
    mkdirs(root, 'apps/web', 'docs/guides', 'scripts/build');

    const blocks = detectConventionalBlocks(root);
    expect(blocks).toEqual([{ name: 'web', path: 'apps/web' }]);
  });

  it('ignores a file sitting directly inside a conventional folder (not a directory)', () => {
    const root = createTempRepo();
    mkdirs(root, 'apps/web');
    writeFileSync(resolve(root, 'apps/README.md'), '# apps');

    const blocks = detectConventionalBlocks(root);
    expect(blocks).toEqual([{ name: 'web', path: 'apps/web' }]);
  });

  it('ignores dot-directories and node_modules inside a conventional folder', () => {
    const root = createTempRepo();
    mkdirs(root, 'packages/ui', 'packages/.turbo', 'packages/node_modules/some-dep');

    const blocks = detectConventionalBlocks(root);
    expect(blocks).toEqual([{ name: 'ui', path: 'packages/ui' }]);
  });

  it('returns no candidates when a conventional folder exists but is empty', () => {
    const root = createTempRepo();
    mkdirs(root, 'packages');

    expect(detectConventionalBlocks(root)).toEqual([]);
  });

  it('returns no candidates when none of the five conventional folders exist', () => {
    const root = createTempRepo();
    mkdirs(root, 'src/auth', 'src/api');

    expect(detectConventionalBlocks(root)).toEqual([]);
  });

  it('returns no candidates for a completely empty repo', () => {
    const root = createTempRepo();
    expect(detectConventionalBlocks(root)).toEqual([]);
  });

  it('follows a symlinked block directory instead of silently dropping it', () => {
    const root = createTempRepo();
    mkdirs(root, 'vendor/real-gateway', 'services');
    symlinkSync(resolve(root, 'vendor/real-gateway'), resolve(root, 'services/gateway'), 'dir');

    const blocks = detectConventionalBlocks(root);
    expect(blocks).toEqual([{ name: 'gateway', path: 'services/gateway' }]);
  });
});
