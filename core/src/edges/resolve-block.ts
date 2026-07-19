// Maps a file path (POSIX-style, relative to rootDir) to its owning block id, by longest
// path-segment-prefix match against the detected BlockNode[] — never a silently dropped
// edge (docs/architecture/DIRECTORY-TREE.md). A file matching no detected block's prefix
// belongs to the synthetic root catch-all; analyze.ts is responsible for appending that
// BlockNode to the result once this function actually returns ROOT_BLOCK_ID for at least
// one file (docs/decisions/0005) — this function only ever needs to return the id string.
import type { BlockNode } from '../types.js';

export const ROOT_BLOCK_ID = '(root)';

function isPrefixMatch(filePath: string, blockPath: string): boolean {
  return filePath === blockPath || filePath.startsWith(`${blockPath}/`);
}

export function resolveBlock(filePath: string, blocks: BlockNode[]): string {
  let best: BlockNode | undefined;

  for (const block of blocks) {
    if (!isPrefixMatch(filePath, block.path)) continue;
    if (!best || block.path.length > best.path.length) best = block;
  }

  return best?.id ?? ROOT_BLOCK_ID;
}
