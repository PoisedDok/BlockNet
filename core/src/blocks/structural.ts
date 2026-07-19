// Strategy 2 of the block-detection cascade (docs/decisions/0005-blocks-auto-detected.md,
// amended after Checkpoint A found the old name-list version collapsed real repos like
// `frontend/`+`backend/`+`desktop/` into a single meaningless block): a breadth-first,
// per-branch walk from rootDir's children. A directory that owns a `package.json` is a
// "host" and becomes one block; its own subtree is never searched further, so a project's
// internal nested tooling doesn't fragment into extra blocks. A directory that isn't a host
// is expanded one level deeper and the same check applies to its children. No folder-name
// vocabulary anywhere: this is why it works on repos that don't call their projects
// `apps/`/`packages/`.
//
// Deliberately JS/TS-only (`hasPackageJson`), after a second Checkpoint A finding: widening
// the host signal to other languages here — searched
// recursively, up to 4 levels deep, from every branch — meant a single incidental non-JS
// manifest anywhere in an unrelated corner of the repo (a `pyproject.toml` 4 levels down
// inside a tooling/skills folder, nothing to do with the actual application) could "win" the
// whole cascade over a much more relevant flat-fallback result. `other-languages.ts` covers
// non-JS hosts instead — additively, top-level-only, never able to preempt this strategy.
import { basename, join } from 'node:path';
import { createRealPathDedup } from '../realpath-dedup.js';
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

export function detectStructuralBlocks(rootDir: string): BlockCandidate[] {
  const candidates: BlockCandidate[] = [];
  // Bounds total *cost*, not just depth — see realpath-dedup.ts for why the depth cap alone
  // isn't enough (a branching symlink cycle costs O(branching^4) without this). Seeding
  // rootDir itself means an alias pointing back at the analyzed root is caught immediately.
  const alreadyVisited = createRealPathDedup();
  alreadyVisited(rootDir);

  let frontier = listChildDirectories(rootDir).map((name) => join(rootDir, name));

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    for (const dir of frontier) {
      if (alreadyVisited(dir)) continue;

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
