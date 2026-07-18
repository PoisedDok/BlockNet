// Shared filesystem helpers for the block-detection cascade. Centralized so the
// symlink-following and root-containment rules below apply identically to every strategy —
// see docs/planning/PROGRESS.md's Task 2 entry for the real-repo bugs this exists to close.
import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

// `Dirent.isDirectory()` (from readdirSync's withFileTypes) does NOT follow symlinks — a
// symlinked workspace member (pnpm-style linking, Nx/Bazel-generated layouts) would
// otherwise silently vanish from every strategy. `statSync` always follows symlinks, which
// is the correct, consistent behavior everywhere a candidate directory is considered.
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Names of `dir`'s child directories (symlinks followed), skipping dot-dirs and
 * `node_modules`. Returns `[]` if `dir` doesn't exist or can't be read (missing, not a
 * directory, or permission-denied — a locked-down mount or root-owned build artifact must
 * degrade the cascade to its next strategy, never crash the whole analysis).
 */
export function listChildDirectories(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
    .filter((e) => e.isDirectory() || (e.isSymbolicLink() && isDirectory(join(dir, e.name))))
    .map((e) => e.name);
}

/**
 * `absDir` as a POSIX-style path relative to `rootDir`, or `undefined` if `absDir` IS
 * `rootDir` (an empty path can't be a block id) or escapes `rootDir` entirely (a workspace
 * pattern or tsconfig reference pointing outside the analyzed root — e.g. `../shared`, or a
 * sibling project when only a subdirectory of a larger monorepo is open). A block path that
 * starts with `..` can never match a file under `rootDir` (Task 3's file-to-block
 * resolution is rootDir-scoped) and would leak a raw filesystem path outside the analyzed
 * root into `GraphResult`, which crosses the process boundary — so it's never a valid
 * candidate, not even a low-confidence one.
 */
export function toBlockRelativePath(rootDir: string, absDir: string): string | undefined {
  const rel = relative(rootDir, absDir);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return rel.split('\\').join('/');
}
