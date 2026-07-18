import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectWorkspaceBlocks } from '../src/blocks/workspaces.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-workspaces-test-'));
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

describe('detectWorkspaceBlocks — npm/yarn `workspaces` field', () => {
  it('returns the checked-in monorepo fixture as one block per workspace member', () => {
    const fixture = resolve(import.meta.dirname, 'fixtures/monorepo');
    const blocks = detectWorkspaceBlocks(fixture);

    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.path).sort()).toEqual(['packages/a', 'packages/b', 'packages/c']);
    // name comes from each member's own package.json `name`, not the folder name — real
    // repos scope package names (@org/pkg) and that's the truthful label, not "a".
    const byPath = Object.fromEntries(blocks.map((b) => [b.path, b]));
    expect(byPath['packages/a']?.name).toBe('a');
    expect(byPath['packages/b']?.name).toBe('b');
    expect(byPath['packages/c']?.name).toBe('c');
  });

  it('resolves a `/*` glob pattern to its matching subdirectories', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    writeJson(resolve(root, 'packages/x/package.json'), { name: 'x' });
    writeJson(resolve(root, 'packages/y/package.json'), { name: 'y' });

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks.map((b) => b.path).sort()).toEqual(['packages/x', 'packages/y']);
  });

  it('resolves a literal (non-glob) workspace entry, matching this repo\'s own root package.json', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['core'] });
    writeJson(resolve(root, 'core/package.json'), { name: '@blocknet/core' });

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks).toEqual([{ name: '@blocknet/core', path: 'core' }]);
  });

  it('supports the yarn object form { packages: [...] }', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: { packages: ['packages/*'] } });
    writeJson(resolve(root, 'packages/x/package.json'), { name: 'x' });

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks).toEqual([{ name: 'x', path: 'packages/x' }]);
  });

  it('skips a glob-matched directory that has no package.json of its own (not a real workspace member)', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    writeJson(resolve(root, 'packages/x/package.json'), { name: 'x' });
    // packages/notes has no package.json — e.g. leftover docs folder, not a workspace member.
    writeText(resolve(root, 'packages/notes/README.md'), '# notes');

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks).toEqual([{ name: 'x', path: 'packages/x' }]);
  });

  it('falls back to the folder name when a member package.json has no `name` field', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    writeJson(resolve(root, 'packages/x/package.json'), { version: '1.0.0' });

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks).toEqual([{ name: 'x', path: 'packages/x' }]);
  });

  it('returns no candidates when package.json has no `workspaces` field', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root' });

    expect(detectWorkspaceBlocks(root)).toEqual([]);
  });

  it('returns no candidates when there is no root package.json at all', () => {
    const root = createTempRepo();
    expect(detectWorkspaceBlocks(root)).toEqual([]);
  });

  it('returns no candidates when a `/*` glob matches nothing (empty dir)', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    mkdirSync(resolve(root, 'packages'), { recursive: true });

    expect(detectWorkspaceBlocks(root)).toEqual([]);
  });

  it('does not crash and still returns other patterns\' members when a glob base directory itself is unreadable', () => {
    const root = createTempRepo();
    // Two patterns: "packages" (its listing will be permission-denied — e.g. a root-owned
    // Docker build artifact, a locked-down mount) and "services" (normal, accessible).
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['packages/*', 'services/*'] });
    writeJson(resolve(root, 'services/x/package.json'), { name: 'x' });
    const packagesDir = resolve(root, 'packages');
    mkdirSync(packagesDir, { recursive: true });
    chmodSync(packagesDir, 0o000);

    try {
      expect(() => detectWorkspaceBlocks(root)).not.toThrow();
      expect(detectWorkspaceBlocks(root)).toEqual([{ name: 'x', path: 'services/x' }]);
    } finally {
      chmodSync(packagesDir, 0o755); // restore so afterEach's recursive rmSync can clean up
    }
  });

  it('follows a symlinked workspace member instead of silently dropping it', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    // Common with pnpm-style linking / Nx-Bazel-generated layouts: the member directory
    // itself is a symlink, not a plain directory.
    writeJson(resolve(root, 'vendor/real-x/package.json'), { name: 'x' });
    mkdirSync(resolve(root, 'packages'), { recursive: true });
    symlinkSync(resolve(root, 'vendor/real-x'), resolve(root, 'packages/x'), 'dir');

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks).toEqual([{ name: 'x', path: 'packages/x' }]);
  });

  it('excludes a workspace pattern that resolves outside rootDir instead of leaking a `..`-prefixed path', () => {
    // A sibling project outside the analyzed root — e.g. only a subdirectory of a larger
    // monorepo is open, an entirely ordinary scenario. `root` and `sibling` are siblings
    // under one disposable container so nothing leaks into the shared OS tmpdir.
    const container = createTempRepo();
    const root = resolve(container, 'root');
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['../sibling'] });
    writeJson(resolve(container, 'sibling/package.json'), { name: 'sibling' });

    expect(detectWorkspaceBlocks(root)).toEqual([]);
  });
});

describe('detectWorkspaceBlocks — tsconfig.json project references', () => {
  it('resolves each reference `path` to its containing directory', () => {
    const root = createTempRepo();
    // No package.json workspaces at all — this repo uses raw tsc project references only.
    writeJson(resolve(root, 'tsconfig.json'), {
      references: [{ path: './services/gateway' }, { path: './services/auth' }],
    });
    mkdirSync(resolve(root, 'services/gateway'), { recursive: true });
    mkdirSync(resolve(root, 'services/auth'), { recursive: true });

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks.map((b) => b.path).sort()).toEqual(['services/auth', 'services/gateway']);
  });

  it('resolves a reference path that points directly at a tsconfig file, not a directory', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'tsconfig.json'), {
      references: [{ path: './services/gateway/tsconfig.json' }],
    });
    writeJson(resolve(root, 'services/gateway/tsconfig.json'), {});

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks).toEqual([{ name: 'gateway', path: 'services/gateway' }]);
  });

  it('parses a tsconfig.json containing comments and trailing commas (real-world JSONC)', () => {
    const root = createTempRepo();
    writeText(
      resolve(root, 'tsconfig.json'),
      `{
        // project references for our two services
        "references": [
          { "path": "./services/gateway" }, // gateway
        ],
      }`,
    );
    mkdirSync(resolve(root, 'services/gateway'), { recursive: true });

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks).toEqual([{ name: 'gateway', path: 'services/gateway' }]);
  });

  it('merges workspaces-derived and tsconfig-reference-derived candidates without duplicates', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    writeJson(resolve(root, 'packages/x/package.json'), { name: 'x' });
    writeJson(resolve(root, 'tsconfig.json'), {
      // References the same package.json workspace member (common in real repos) plus a
      // second, package.json-less project.
      references: [{ path: './packages/x' }, { path: './services/gateway' }],
    });
    mkdirSync(resolve(root, 'services/gateway'), { recursive: true });

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks.map((b) => b.path).sort()).toEqual(['packages/x', 'services/gateway']);
  });

  it('does not crash and returns other candidates when tsconfig.json is malformed', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
    writeJson(resolve(root, 'packages/x/package.json'), { name: 'x' });
    writeText(resolve(root, 'tsconfig.json'), '{ this is not valid JSON at all !!');

    expect(() => detectWorkspaceBlocks(root)).not.toThrow();
    expect(detectWorkspaceBlocks(root)).toEqual([{ name: 'x', path: 'packages/x' }]);
  });

  it('returns no candidates when tsconfig.json exists but has no `references`', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'tsconfig.json'), { compilerOptions: { strict: true } });

    expect(detectWorkspaceBlocks(root)).toEqual([]);
  });

  it('excludes a reference that resolves to rootDir itself instead of producing an empty-string id', () => {
    const root = createTempRepo();
    writeJson(resolve(root, 'tsconfig.json'), { references: [{ path: '.' }] });

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks.some((b) => b.path === '' || b.id === '')).toBe(false);
    expect(blocks).toEqual([]);
  });

  it('excludes a reference that resolves outside rootDir instead of leaking a `..`-prefixed path', () => {
    const container = createTempRepo();
    const root = resolve(container, 'root');
    writeJson(resolve(root, 'tsconfig.json'), { references: [{ path: '../sibling' }] });
    mkdirSync(resolve(container, 'sibling'), { recursive: true });

    expect(detectWorkspaceBlocks(root)).toEqual([]);
  });

  it('still resolves `references` correctly when an unrelated typo elsewhere in tsconfig.json trips jsonc-parser recovery', () => {
    const root = createTempRepo();
    // Missing comma inside compilerOptions — a common hand-edit slip. jsonc-parser recovers
    // a fully-correct `references` array from this; bailing on ANY parse error (even ones
    // unrelated to `references`) would silently downgrade a real monorepo to a weaker
    // cascade strategy for a typo nowhere near the field that matters.
    writeText(
      resolve(root, 'tsconfig.json'),
      '{"compilerOptions":{"strict":true "target":"ES2022"},"references":[{"path":"./services/gateway"}]}',
    );
    mkdirSync(resolve(root, 'services/gateway'), { recursive: true });

    const blocks = detectWorkspaceBlocks(root);
    expect(blocks).toEqual([{ name: 'gateway', path: 'services/gateway' }]);
  });
});
