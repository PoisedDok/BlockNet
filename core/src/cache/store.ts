// Persists the cache to a single JSON file under an injected cache directory
// (docs/architecture/STATE-OWNERSHIP.md). Manifest, GraphResult snapshot, and the
// pre-aggregation FileEdge[] the delta path needs to merge into are written together, in
// ONE file, not three independently-atomic ones: if a crash or kill happened between two
// separate atomic writes (each individually torn-write-safe), the manifest on disk could
// already reflect the new state while the paired snapshot still reflects the old one —
// cache/invalidate.ts would then see "no diff" against the new-but-orphaned manifest and
// serve the stale snapshot forever. Writing all three as one JSON blob, via write-temp-
// then-rename (atomic on the same volume on POSIX and NTFS — see STATE-OWNERSHIP.md's
// multi-window-safety section), makes that interleaving impossible: a reader only ever
// observes the fully-old file or the fully-new one.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createLogger, type Logger } from '../log.js';
import type { CacheManifest, FileEdge, GraphResult } from '../types.js';

const CACHE_FILE_NAME = 'blocknet-cache.json';

type CachePayload = {
  manifest: CacheManifest;
  snapshot: GraphResult;
  fileEdges: FileEdge[];
};

export function writeCache(cacheDir: string, manifest: CacheManifest, snapshot: GraphResult, fileEdges: FileEdge[]): void {
  mkdirSync(cacheDir, { recursive: true });
  const payload: CachePayload = { manifest, snapshot, fileEdges };
  const finalPath = join(cacheDir, CACHE_FILE_NAME);
  const tempPath = join(cacheDir, `.${CACHE_FILE_NAME}.${randomUUID()}.tmp`);
  writeFileSync(tempPath, JSON.stringify(payload));
  renameSync(tempPath, finalPath);
}

/** Reads back the cache written by writeCache. Returns undefined for anything short of a
 * fully-valid, fully-written cache file — missing directory, never written, or corrupted
 * (a torn write from an external cause, e.g. the disk filling up mid-write to `cacheDir`
 * itself, or manual tampering) all degrade to "no cache," never a thrown error, matching
 * the rest of the pipeline's established never-crash-on-untrusted-disk-state convention.
 * A missing cache file is the ordinary cold-start case and stays silent; a cache file that
 * exists but fails to parse is an anomaly worth a warning, matching the degrade-with-warning
 * convention established elsewhere (tsconfig-utils.ts, edges/file-graph.ts). */
export function readCache(cacheDir: string, logger: Logger = createLogger()): CachePayload | undefined {
  const path = join(cacheDir, CACHE_FILE_NAME);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }

  try {
    return JSON.parse(raw) as CachePayload;
  } catch {
    logger.warn(`${path}: cache file is corrupted (invalid JSON) — ignoring and falling back to a full scan`);
    return undefined;
  }
}
