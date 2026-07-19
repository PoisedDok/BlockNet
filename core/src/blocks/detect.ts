// Cascade entry point (docs/decisions/0005-blocks-auto-detected.md): first non-empty
// strategy wins — workspaces/tsconfig-refs, then the generic structural host-walk, then the
// flat-src fallback. After that base cascade resolves (or comes up empty), an additive step
// (other-languages.ts) checks rootDir's own top-level children for a non-JS project manifest
// not already covered — this is how a real polyglot repo's Python/Go/Rust sibling shows up
// as its own block even though the base 3 strategies are JS/TS-only. Turns the combined raw
// candidates into full BlockNode[] with pills.
//
// Deliberately NOT done here: the synthetic "(root)" catch-all block the ADR describes. Its
// existence depends on whether any real file fails to match every detected block's path
// prefix — a fact only edges/resolve-block.ts (Task 3) can know, since detect.ts never walks
// files. Appending it here now would mean fabricating fileCount:0 on a block that might not
// need to exist at all, which contradicts the truth requirement (docs/PRINCIPLES.md) this
// same ADR is built on. analyze.ts appends it conditionally once Task 3 lands.
import { join } from 'node:path';
import type { BlockNode } from '../types.js';
import { detectFlatFallbackBlocks } from './flat-fallback.js';
import type { BlockCandidate } from './internal-types.js';
import { detectOtherLanguageTopLevelBlocks } from './other-languages.js';
import { derivePills } from './pills.js';
import { detectStructuralBlocks } from './structural.js';
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
  const strategies = [detectWorkspaceBlocks, detectStructuralBlocks, detectFlatFallbackBlocks];

  let candidates: BlockCandidate[] = [];
  for (const strategy of strategies) {
    const found = strategy(rootDir);
    if (found.length > 0) {
      candidates = found;
      break;
    }
  }

  candidates = [...candidates, ...detectOtherLanguageTopLevelBlocks(rootDir, candidates)];

  return toBlockNodes(candidates, rootDir);
}
