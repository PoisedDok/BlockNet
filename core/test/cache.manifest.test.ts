import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildManifest } from '../src/cache/manifest.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-cache-manifest-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function writeText(root: string, relPath: string, contents: string) {
  const abs = resolve(root, relPath);
  mkdirSync(resolve(abs, '..'), { recursive: true });
  writeFileSync(abs, contents);
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

describe('buildManifest — per-file content hash', () => {
  it('hashes each file to its real sha256 content hash', () => {
    const root = createTempRepo();
    writeText(root, 'src/index.ts', 'export const a = 1;\n');

    const manifest = buildManifest(root, ['src/index.ts']);

    expect(manifest.files['src/index.ts']?.hash).toBe(sha256('export const a = 1;\n'));
  });

  it('gives two files with identical content the same hash, and different content a different hash', () => {
    const root = createTempRepo();
    writeText(root, 'a.ts', 'export const x = 1;\n');
    writeText(root, 'b.ts', 'export const x = 1;\n');
    writeText(root, 'c.ts', 'export const x = 2;\n');

    const manifest = buildManifest(root, ['a.ts', 'b.ts', 'c.ts']);

    expect(manifest.files['a.ts']?.hash).toBe(manifest.files['b.ts']?.hash);
    expect(manifest.files['a.ts']?.hash).not.toBe(manifest.files['c.ts']?.hash);
  });

  it('degrades to omitting a file that vanishes before it can be read, rather than crashing', () => {
    const root = createTempRepo();
    writeText(root, 'src/index.ts', 'export {};\n');

    const manifest = buildManifest(root, ['src/index.ts', 'src/gone.ts']);

    expect(Object.keys(manifest.files)).toEqual(['src/index.ts']);
  });

  it('records CACHE_VERSION as the manifest version', () => {
    const root = createTempRepo();
    const manifest = buildManifest(root, []);
    expect(manifest.version).toBe(1);
  });
});

describe('buildManifest — non-source files never get their full content read', () => {
  // A file dependency-cruiser could never treat as a module (a binary asset, an archive, a
  // video, a PDF) can never affect any FileEdge/Risk regardless of its content — only its
  // EXISTENCE matters (already tracked via the manifest's key set, for fileCount/structural-
  // change detection). Reading such a file's full bytes to hash it is pure waste, and on a
  // real repo, catastrophic waste: a real Docker-image archive checked into a real Aether
  // repo measured at 504MB, turning a claimed "instant" cache hit into a 10-second read.

  it('gives two non-source files with DIFFERENT content the SAME hash — content is never read for them', () => {
    const root = createTempRepo();
    writeText(root, 'assets/one.bin', 'completely different content A');
    writeText(root, 'assets/two.bin', 'totally different content B, much longer than A');

    const manifest = buildManifest(root, ['assets/one.bin', 'assets/two.bin']);

    expect(manifest.files['assets/one.bin']?.hash).toBe(manifest.files['assets/two.bin']?.hash);
  });

  it('does not read a huge non-source file at all — manifest building over it stays fast', () => {
    const root = createTempRepo();
    // 50MB of zero bytes — if this were read and hashed, it would show up as measurable time;
    // reading none of it should be near-instant regardless of test-machine speed.
    writeText(root, 'archive.tar.gz', '0'.repeat(50 * 1024 * 1024));

    const startedAt = Date.now();
    buildManifest(root, ['archive.tar.gz']);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('still hashes real TS/JS source file content precisely, unaffected by the non-source shortcut', () => {
    const root = createTempRepo();
    writeText(root, 'src/index.ts', 'export const a = 1;\n');
    writeText(root, 'src/other.ts', 'export const a = 2;\n');

    const manifest = buildManifest(root, ['src/index.ts', 'src/other.ts']);

    expect(manifest.files['src/index.ts']?.hash).toBe(sha256('export const a = 1;\n'));
    expect(manifest.files['src/index.ts']?.hash).not.toBe(manifest.files['src/other.ts']?.hash);
  });

  it('treats .mts and .cts as real TS/JS source, not non-source — dependency-cruiser parses ' +
    'both (tsPreCompilationDeps, TS-compatible extensions), so mis-bucketing them here would ' +
    'silently serve stale edges after a real import change (e.g. a real vite.config.mts)', () => {
    const root = createTempRepo();
    writeText(root, 'vite.config.mts', 'export const a = 1;\n');
    writeText(root, 'src/native.cts', 'export const b = 1;\n');

    const manifest = buildManifest(root, ['vite.config.mts', 'src/native.cts']);

    expect(manifest.files['vite.config.mts']?.hash).toBe(sha256('export const a = 1;\n'));
    expect(manifest.files['src/native.cts']?.hash).toBe(sha256('export const b = 1;\n'));
  });

  it('still tracks a non-source file\'s existence (present in manifest.files) so add/remove is still detected', () => {
    const root = createTempRepo();
    writeText(root, 'assets/logo.png', 'fake-png-bytes');

    const manifest = buildManifest(root, ['assets/logo.png']);

    expect(manifest.files['assets/logo.png']).toBeDefined();
  });
});

describe('buildManifest — configHash', () => {
  it('changes when a package.json anywhere in the file list changes content', () => {
    const root = createTempRepo();
    writeText(root, 'package.json', '{"name":"a"}');
    writeText(root, 'src/index.ts', 'export {};\n');
    const files = ['package.json', 'src/index.ts'];

    const before = buildManifest(root, files);
    writeText(root, 'package.json', '{"name":"a","dependencies":{"chalk":"^5.0.0"}}');
    const after = buildManifest(root, files);

    expect(before.configHash).not.toBe(after.configHash);
  });

  it('changes when a tsconfig.json anywhere in the file list changes content', () => {
    const root = createTempRepo();
    writeText(root, 'tsconfig.json', '{"compilerOptions":{}}');
    const files = ['tsconfig.json'];

    const before = buildManifest(root, files);
    writeText(root, 'tsconfig.json', '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}');
    const after = buildManifest(root, files);

    expect(before.configHash).not.toBe(after.configHash);
  });

  it('does NOT change when a plain source file changes — only config files affect it', () => {
    const root = createTempRepo();
    writeText(root, 'package.json', '{"name":"a"}');
    writeText(root, 'src/index.ts', 'export const a = 1;\n');
    const files = ['package.json', 'src/index.ts'];

    const before = buildManifest(root, files);
    writeText(root, 'src/index.ts', 'export const a = 2;\n');
    const after = buildManifest(root, files);

    expect(before.configHash).toBe(after.configHash);
  });

  it('is order-independent — the same set of config files in a different list order yields the same configHash', () => {
    const root = createTempRepo();
    writeText(root, 'package.json', '{"name":"a"}');
    writeText(root, 'packages/b/package.json', '{"name":"b"}');

    const a = buildManifest(root, ['package.json', 'packages/b/package.json']);
    const b = buildManifest(root, ['packages/b/package.json', 'package.json']);

    expect(a.configHash).toBe(b.configHash);
  });

  it('covers every package.json/tsconfig.json in the tree, not just the root\'s own', () => {
    const root = createTempRepo();
    writeText(root, 'package.json', '{"name":"root"}');
    writeText(root, 'packages/a/package.json', '{"name":"a"}');
    const files = ['package.json', 'packages/a/package.json'];

    const before = buildManifest(root, files);
    writeText(root, 'packages/a/package.json', '{"name":"a","dependencies":{"react":"^18.0.0"}}');
    const after = buildManifest(root, files);

    expect(before.configHash).not.toBe(after.configHash);
  });

  it('is stable (same hash) for an unchanged file set and content', () => {
    const root = createTempRepo();
    writeText(root, 'package.json', '{"name":"a"}');
    const files = ['package.json'];

    const a = buildManifest(root, files);
    const b = buildManifest(root, files);
    expect(a.configHash).toBe(b.configHash);
  });
});
