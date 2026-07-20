import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCache, writeCache } from '../src/cache/store.js';
import { createLogger } from '../src/log.js';
import type { CacheManifest, FileEdge, GraphResult } from '../src/types.js';

const tempDirs: string[] = [];
function createTempDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-cache-store-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

const sampleManifest: CacheManifest = {
  version: 1,
  configHash: 'abc123',
  files: { 'src/index.ts': { hash: 'deadbeef' } },
};

const sampleSnapshot: GraphResult = {
  blocks: [{ id: '(root)', name: '(root)', path: '(root)', pills: [], fileCount: 1, riskCount: 0 }],
  edges: [],
  risks: [],
  meta: { analyzedAt: '2026-07-19T00:00:00.000Z', durationMs: 5, fileCount: 1, cacheHit: false },
};

const sampleFileEdges: FileEdge[] = [
  { sourceFile: 'src/a.ts', targetFile: 'src/b.ts', statement: "import './b.js'", line: 1 },
];

describe('writeCache / readCache — round trip', () => {
  it('reads back exactly what was written', () => {
    const cacheDir = createTempDir();
    writeCache(cacheDir, sampleManifest, sampleSnapshot, sampleFileEdges);

    const loaded = readCache(cacheDir);
    expect(loaded).toEqual({ manifest: sampleManifest, snapshot: sampleSnapshot, fileEdges: sampleFileEdges });
  });

  it('creates the cache directory if it does not exist yet', () => {
    const parent = createTempDir();
    const cacheDir = resolve(parent, 'nested/cache-dir');
    expect(existsSync(cacheDir)).toBe(false);

    writeCache(cacheDir, sampleManifest, sampleSnapshot, sampleFileEdges);

    expect(readCache(cacheDir)).toEqual({ manifest: sampleManifest, snapshot: sampleSnapshot, fileEdges: sampleFileEdges });
  });

  it('leaves no stray temp file behind after a write (atomic rename, not a leftover partial file)', () => {
    const cacheDir = createTempDir();
    writeCache(cacheDir, sampleManifest, sampleSnapshot, sampleFileEdges);

    const entries = readdirSync(cacheDir);
    expect(entries.every((name) => !name.includes('.tmp'))).toBe(true);
  });

  it('overwrites a previous cache with a newer one', () => {
    const cacheDir = createTempDir();
    writeCache(cacheDir, sampleManifest, sampleSnapshot, sampleFileEdges);

    const newerManifest: CacheManifest = { ...sampleManifest, configHash: 'newhash' };
    writeCache(cacheDir, newerManifest, sampleSnapshot, sampleFileEdges);

    expect(readCache(cacheDir)?.manifest.configHash).toBe('newhash');
  });
});

describe('readCache — degrade, never crash', () => {
  it('returns undefined for a cache directory that was never written', () => {
    const cacheDir = createTempDir();
    expect(readCache(cacheDir)).toBeUndefined();
  });

  it('returns undefined for a cache directory that does not exist at all', () => {
    const parent = createTempDir();
    expect(readCache(resolve(parent, 'does-not-exist'))).toBeUndefined();
  });

  it('returns undefined for a corrupted (truncated/invalid JSON) cache file rather than throwing', () => {
    const cacheDir = createTempDir();
    writeCache(cacheDir, sampleManifest, sampleSnapshot, sampleFileEdges);

    // Corrupt the file directly — simulates a torn write from an external cause (disk full,
    // killed process mid-write to a non-atomic location, manual tampering).
    const files = readdirSync(cacheDir).filter((name) => !name.includes('.tmp'));
    for (const name of files) {
      writeFileSync(resolve(cacheDir, name), '{not valid json');
    }

    expect(readCache(cacheDir)).toBeUndefined();
  });

  it('warns (does not stay silent) when the cache file exists but is corrupted — an anomaly, unlike a plain cold start', () => {
    const cacheDir = createTempDir();
    writeCache(cacheDir, sampleManifest, sampleSnapshot, sampleFileEdges);
    const files = readdirSync(cacheDir).filter((name) => !name.includes('.tmp'));
    for (const name of files) {
      writeFileSync(resolve(cacheDir, name), '{not valid json');
    }

    const warnings: string[] = [];
    readCache(cacheDir, createLogger('debug', (level, message) => level === 'warn' && warnings.push(message)));

    expect(warnings).toHaveLength(1);
  });

  it('does NOT warn for the ordinary cold-start case (cache directory never written)', () => {
    const cacheDir = createTempDir();
    const warnings: string[] = [];
    readCache(cacheDir, createLogger('debug', (level, message) => level === 'warn' && warnings.push(message)));

    expect(warnings).toHaveLength(0);
  });
});

describe('writeCache / readCache — atomicity as a single unit', () => {
  it('manifest and snapshot are written together, in one file, so a reader can never observe a newer manifest paired with a stale snapshot', () => {
    // Both single-file storage (verified by directory listing) and the round-trip tests above
    // together prove this: there is exactly one artifact file, so a partial write can never
    // leave a self-consistent-looking but mismatched manifest/snapshot pair on disk — the
    // rename either lands the whole new state or the old state is untouched.
    const cacheDir = createTempDir();
    writeCache(cacheDir, sampleManifest, sampleSnapshot, sampleFileEdges);

    const dataFiles = readdirSync(cacheDir).filter((name) => !name.includes('.tmp'));
    expect(dataFiles).toHaveLength(1);
  });
});
