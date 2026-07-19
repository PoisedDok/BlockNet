// Generic, all-languages file inventory (docs/planning/PROGRESS.md's Checkpoint A entry): the
// engine analyzes imports for TS/JS only (docs/decisions/0004), but a block's `fileCount` and
// `meta.fileCount` count every real file regardless of language — a Python/Go/Rust
// sub-project is still real content, and hiding it behind a TS/JS-only count is a truth gap,
// not a feature. Uses the exact same exclude definition as edges/depcruise-runner.ts
// (path-utils.ts's `EXCLUDE_PATTERN_SOURCE`) so the two file inventories — "what
// dependency-cruiser scanned" and "what's really here" — can never silently disagree about
// what counts as source.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isExcludedPath } from './path-utils.js';
import { createRealPathDedup } from './realpath-dedup.js';

function toRelativePosix(rootDir: string, absPath: string): string {
  return relative(rootDir, absPath).split('\\').join('/');
}

// `Dirent.isDirectory()`/`isFile()` (from readdirSync's withFileTypes) do NOT follow
// symlinks — `statSync` always does, matching blocks/fs-utils.ts's established convention so
// a symlinked file or directory is never silently dropped.
function resolvedKind(absPath: string): 'file' | 'directory' | 'other' {
  try {
    const stats = statSync(absPath);
    if (stats.isDirectory()) return 'directory';
    if (stats.isFile()) return 'file';
    return 'other';
  } catch {
    return 'other'; // broken symlink, race with a concurrent delete — skip, never crash
  }
}

export function walkRealFiles(rootDir: string): string[] {
  const files: string[] = [];
  const alreadyVisited = createRealPathDedup();
  alreadyVisited(rootDir);

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing, not a directory, or permission-denied — degrade, never crash
    }

    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      const relPath = toRelativePosix(rootDir, absPath);
      if (isExcludedPath(relPath)) continue;

      const kind = entry.isSymbolicLink() ? resolvedKind(absPath) : entry.isDirectory() ? 'directory' : 'file';

      if (kind === 'directory') {
        if (alreadyVisited(absPath)) continue;
        walk(absPath);
      } else if (kind === 'file') {
        // The same real-path dedup applied to directories above, applied to files too: a
        // single physical file reachable via more than one symlinked path (a real pattern —
        // Nx/Bazel-style tooling symlinking one shared file into several package directories)
        // must count once, not once per alias.
        if (alreadyVisited(absPath)) continue;
        files.push(relPath);
      }
    }
  }

  walk(rootDir);
  return files;
}
