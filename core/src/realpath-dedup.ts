// Shared cycle-safety mechanism for any recursive, symlink-following directory walk in this
// codebase (blocks/structural.ts's host-detection BFS, file-walk.ts's generic file inventory).
// A depth cap alone bounds recursion *depth*, not *cost*: two real directories each holding
// symlinks back to the other cost O(branching^4) frontier entries — 30 cross-symlinks each way
// measured at over 12 seconds, independent of any real file/directory count — confirmed by
// direct testing (docs/planning/PROGRESS.md's Checkpoint A entry). Deduping by real
// (symlink-resolved) path caps total work at the number of distinct real directories actually
// reachable: once a real directory has been visited via any path, every other path to it —
// cyclic or not — is skipped before any further work happens on it. This alone also guarantees
// termination with no depth cap at all, since a real filesystem has finitely many directories.
import { realpathSync } from 'node:fs';

/**
 * Returns a predicate that's true the first time it's called for a given directory's real
 * path, and true (meaning "skip it") every time after — for any alias (symlink or otherwise)
 * that resolves to a real path already seen. A directory whose real path can't be resolved
 * (broken symlink, race with a concurrent delete) is treated as already-visited: skip it,
 * never crash the walk.
 */
export function createRealPathDedup(): (dir: string) => boolean {
  const visited = new Set<string>();

  return (dir: string): boolean => {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return true;
    }
    if (visited.has(real)) return true;
    visited.add(real);
    return false;
  };
}
