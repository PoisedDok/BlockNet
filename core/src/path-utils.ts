// Shared path-containment predicate. Used by blocks/fs-utils.ts (workspace/tsconfig-
// reference candidates) and edges/{depcruise-runner,file-graph}.ts (resolved import
// targets) so a path-escape bug fixed once for block detection (docs/planning/PROGRESS.md's
// Task 2 entry — a sibling-project reference like `../shared`, ordinary when only a
// subdirectory of a larger monorepo is open) can't silently reappear, unguarded, in a
// sibling module that computes the same class of check independently. Confirmed as a real,
// not hypothetical, gap during Task 3's review: a plain relative import climbing out of
// rootDir (`../../outside/thing.ts`) resolved and leaked into the file graph with no guard
// at all, attributing a filesystem path outside the analyzed root to the `(root)` block.

/**
 * True if `posixRelativePath` (already POSIX-separated, already relative to some root)
 * stays within that root — not empty, not `..`, doesn't start with a `../` segment, and
 * isn't absolute.
 */
export function isWithinRoot(posixRelativePath: string): boolean {
  return (
    posixRelativePath !== '' &&
    posixRelativePath !== '..' &&
    !posixRelativePath.startsWith('../') &&
    !posixRelativePath.startsWith('/')
  );
}
