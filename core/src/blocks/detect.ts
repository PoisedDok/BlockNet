// Cascade entry point (docs/decisions/0005-blocks-auto-detected.md): first non-empty
// strategy wins — workspaces/tsconfig-refs, then conventional folders, then the flat-src
// fallback. Turns each strategy's raw candidates into full BlockNode[] with pills.
//
// Deliberately NOT done here: the synthetic "(root)" catch-all block the ADR describes. Its
// existence depends on whether any real file fails to match every detected block's path
// prefix — a fact only edges/resolve-block.ts (Task 3) can know, since detect.ts never walks
// files. Appending it here now would mean fabricating fileCount:0 on a block that might not
// need to exist at all, which contradicts the truth requirement (docs/PRINCIPLES.md) this
// same ADR is built on. analyze.ts appends it conditionally once Task 3 lands.
import { join } from 'node:path';
import type { BlockNode } from '../types.js';
import { detectConventionalBlocks } from './conventional.js';
import { detectFlatFallbackBlocks } from './flat-fallback.js';
import type { BlockCandidate } from './internal-types.js';
import { derivePills } from './pills.js';
import { detectWorkspaceBlocks } from './workspaces.js';

function toBlockNodes(candidates: BlockCandidate[], rootDir: string): BlockNode[] {
  return candidates.map((candidate) => ({
    id: candidate.path,
    name: candidate.name,
    path: candidate.path,
    pills: derivePills(join(rootDir, candidate.path), rootDir),
    fileCount: 0,
    riskCount: 0,
  }));
}

export function detectBlocks(rootDir: string): BlockNode[] {
  const strategies = [detectWorkspaceBlocks, detectConventionalBlocks, detectFlatFallbackBlocks];

  for (const strategy of strategies) {
    const candidates = strategy(rootDir);
    if (candidates.length > 0) return toBlockNodes(candidates, rootDir);
  }

  return [];
}
