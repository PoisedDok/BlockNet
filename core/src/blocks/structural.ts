// Strategy 2 of the block-detection cascade (docs/decisions/0005-blocks-auto-detected.md,
// amended after Checkpoint A found the old name-list version collapsed real repos like
// `frontend/`+`backend/`+`desktop/` into a single meaningless block): a breadth-first,
// per-branch walk from rootDir's children. A directory that owns a `package.json` is a
// "host" — a real, self-contained JS/TS project — and becomes one block; its own subtree is
// never searched further, so a project's internal nested tooling doesn't fragment into extra
// blocks. A directory that isn't a host is expanded one level deeper and the same check
// applies to its children. No folder-name vocabulary anywhere: this is why it works on repos
// that don't call their projects `apps/` or `packages/`.
import { realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { hasPackageJson, listChildDirectories, toBlockRelativePath } from './fs-utils.js';
import type { BlockCandidate } from './internal-types.js';

// How many directory levels below rootDir to search before giving up on a branch. Bounds
// both the cost and the surprise-factor of a container hierarchy that never resolves to a
// real project (a docs/ or data/ tree with no package.json anywhere) — without this, a
// branch like that gets walked to the bottom of the real filesystem for nothing. 4 levels
// comfortably covers real nesting shapes seen so far (`backend/packages/harness` is 3) with
// headroom; deeper structures are out of scope for v1 auto-detection (`blocknet.json`
// override is the v2 escape hatch for a heuristic miss, per ROADMAP-V2 v2.5).
const MAX_DEPTH = 4;

// The depth cap alone bounds recursion *depth*, not total cost: a symlink cycle with
// branching factor B (e.g. two real directories each holding symlinks back to the other)
// costs O(B^4) frontier entries — 2 real directories with 30 cross-symlinks each measured at
// over 12 seconds, independent of any real file/directory count, before this guard existed.
// Deduping by real (symlink-resolved) path caps total work at the number of *distinct real
// directories* reachable within the depth cap, regardless of how many alias paths — cyclic
// or not — lead to them: once a real directory has been visited via any path, every other
// path to it is skipped outright, before either a package.json check or a recursive listing.
function alreadyVisited(dir: string, visitedRealPaths: Set<string>): boolean {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return true; // unresolvable (broken symlink, race with a delete) — skip, never crash
  }
  if (visitedRealPaths.has(real)) return true;
  visitedRealPaths.add(real);
  return false;
}

export function detectStructuralBlocks(rootDir: string): BlockCandidate[] {
  const candidates: BlockCandidate[] = [];
  const visitedRealPaths = new Set<string>();
  try {
    visitedRealPaths.add(realpathSync(rootDir));
  } catch {
    // rootDir itself unresolvable — every candidate walk below will fail identically and
    // degrade to "no candidates found," never a crash.
  }

  let frontier = listChildDirectories(rootDir).map((name) => join(rootDir, name));

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    for (const dir of frontier) {
      if (alreadyVisited(dir, visitedRealPaths)) continue;

      if (hasPackageJson(dir)) {
        const path = toBlockRelativePath(rootDir, dir);
        if (path !== undefined) candidates.push({ name: basename(dir), path });
        continue;
      }
      nextFrontier.push(...listChildDirectories(dir).map((name) => join(dir, name)));
    }

    frontier = nextFrontier;
  }

  return candidates;
}
