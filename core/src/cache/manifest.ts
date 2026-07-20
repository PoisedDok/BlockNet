// Builds the content-hash CacheManifest (docs/decisions/0008) that cache/invalidate.ts diffs
// against on the next analyze() call. Two hashes, two different jobs:
//
// - Per-file `hash` (files[path].hash): a pure function of one file's own bytes. A change
//   here means exactly one thing — that file's own outgoing edges may have changed — and is
//   what lets cache/invalidate.ts scope re-extraction to just the files that actually changed
//   (ADR-0008 rule 1).
// - `configHash`: a single hash over every package.json and tsconfig.json found anywhere in
//   the analyzed tree, not just rootDir's own. Any of these can change import resolution
//   globally (a tsconfig `paths` alias, a package.json `workspaces`/`exports`/`main` field
//   read by blocks/boundary.ts) in ways a single file's content hash can't localize — so a
//   change to ANY of them forces the full-bust path (ADR-0008 rule 3), never a scoped delta.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { CacheManifest } from '../types.js';

export const CACHE_VERSION = 1;

// Every extension dependency-cruiser actually parses as TS/JS-compatible with
// tsPreCompilationDeps: true (edges/depcruise-runner.ts always passes this option) — verified
// directly against dependency-cruiser's own TS_COMPATIBLE_EXTENSIONS list, not guessed at.
// `.mts`/`.cts` (Node's native ESM/CJS TypeScript extensions — a real vite.config.mts is a
// mainstream pattern, not exotic) were missing from an earlier version of this list, which
// silently misclassified them as non-source: their content edits never registered as
// "changed," so a real import change inside one was never re-extracted and the cache served
// stale edges/risks indefinitely (confirmed by direct reproduction — see
// docs/planning/PROGRESS.md's Task 5 entry). A file outside this set can never be a
// dependency-cruiser module (docs/decisions/0004: import/edge analysis is TS/JS-only) and
// therefore can never produce or change a FileEdge — its EXISTENCE matters for
// fileCount/structural-change detection (already tracked via the manifest's key set), but
// its CONTENT never does. Reading it anyway is pure waste — a real Aether repo was measured
// with a 504MB Docker-image archive and two 69MB PDFs checked in, which turned a claimed
// "instant" cache hit into a 10-second full-content read before this existed. See
// NON_SOURCE_HASH below. Mirrors risks/boundary.ts's RESOLVABLE_EXTENSIONS (minus the
// extension-less entry, which doesn't apply here — every real file already has whatever
// extension it has) — that list had the identical .mts/.cts gap, fixed alongside this one.
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

// A constant placeholder, never derived from content — used for any file outside
// SOURCE_EXTENSIONS (and not a config file) so its bytes are never read. Its value is
// arbitrary; only two properties matter: it's the same for every non-source file (so their
// content can never spuriously look "changed" against each other) and it's never mistaken
// for a real content hash.
const NON_SOURCE_HASH = 'non-source-file-untracked';

function hashContents(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

/** Reads a file's content and hashes it. Returns undefined if the file can't be read — a
 * real race between the caller's file walk and this read (the same class of race
 * edges/file-graph.ts's evidence lookup already degrades for), not a hypothetical one. */
function hashFile(absPath: string): string | undefined {
  try {
    return hashContents(readFileSync(absPath, 'utf-8'));
  } catch {
    return undefined;
  }
}

function isConfigFile(relPath: string): boolean {
  const name = basename(relPath);
  return name === 'package.json' || name === 'tsconfig.json';
}

function isContentRelevant(relPath: string): boolean {
  return isConfigFile(relPath) || SOURCE_EXTENSIONS.has(extname(relPath));
}

/** Order-independent: sorts config file paths before hashing so the same file set always
 * produces the same configHash regardless of the caller's own file-list ordering. */
function computeConfigHash(rootDir: string, files: string[]): string {
  const configFiles = files.filter(isConfigFile).sort();
  const hash = createHash('sha256');
  for (const relPath of configFiles) {
    const contents = hashFile(join(rootDir, relPath));
    if (contents === undefined) continue;
    hash.update(relPath);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Builds the manifest for the current state of `files` (as returned by file-walk.ts's
 * walkRealFiles). A file that can't be read is silently omitted (degrade, never crash) — it
 * will read as "removed" on the next invalidation diff, which is the safe interpretation of a
 * file that's unreadable right now. */
export function buildManifest(rootDir: string, files: string[]): CacheManifest {
  const manifestFiles: CacheManifest['files'] = {};

  for (const relPath of files) {
    const hash = isContentRelevant(relPath) ? hashFile(join(rootDir, relPath)) : NON_SOURCE_HASH;
    if (hash === undefined) continue;
    manifestFiles[relPath] = { hash };
  }

  return {
    version: CACHE_VERSION,
    configHash: computeConfigHash(rootDir, files),
    files: manifestFiles,
  };
}
