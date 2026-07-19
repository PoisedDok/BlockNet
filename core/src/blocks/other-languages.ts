// Additive step in the block-detection pipeline (docs/decisions/0005-blocks-auto-detected.md's
// 2026-07-19 amendment), run after the base 3-strategy cascade regardless of which strategy
// won or whether any did: checks rootDir's own immediate top-level children — and ONLY that
// level, no recursion — for a non-JS project manifest (fs-utils.ts's
// `hasOtherLanguageManifest`). A child already covered by an existing candidate (the exact
// same path, or an ancestor of one) is skipped — it isn't really "unclaimed."
//
// Deliberately shallow, not folded into structural.ts's recursive walk: a second Checkpoint A
// finding showed that recognizing non-JS manifests inside that 4-level recursive search let a
// single incidental manifest anywhere in the tree (a `pyproject.toml` 4 levels deep inside an
// unrelated tooling/skills folder, nothing to do with the actual application) "win" the whole
// cascade over a much more relevant flat-fallback result. Restricting this to rootDir's own
// immediate children only matches every real case actually seen — AetherArenaV2's `backend/`
// had its manifest at its own top level, sibling to `frontend/`/`desktop/`/`open-connector/`
// — without that blast radius.
import { join } from 'node:path';
import { hasOtherLanguageManifest, listChildDirectories, toBlockRelativePath } from './fs-utils.js';
import type { BlockCandidate } from './internal-types.js';

function isAlreadyCovered(childName: string, existingPaths: string[]): boolean {
  return existingPaths.some((path) => path === childName || path.startsWith(`${childName}/`));
}

export function detectOtherLanguageTopLevelBlocks(rootDir: string, existing: BlockCandidate[]): BlockCandidate[] {
  const existingPaths = existing.map((candidate) => candidate.path);
  const candidates: BlockCandidate[] = [];

  for (const name of listChildDirectories(rootDir)) {
    if (isAlreadyCovered(name, existingPaths)) continue;

    const dir = join(rootDir, name);
    if (!hasOtherLanguageManifest(dir)) continue;

    const path = toBlockRelativePath(rootDir, dir);
    if (path !== undefined) candidates.push({ name, path });
  }

  return candidates;
}
