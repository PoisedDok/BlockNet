// Strategy 3 (last resort) of the block-detection cascade
// (docs/decisions/0005-blocks-auto-detected.md): one block per top-level folder under a
// single-package repo's `src/`. Runs only when strategies 1 and 2 both found nothing.
import { join } from 'node:path';
import { listChildDirectories } from './fs-utils.js';
import type { BlockCandidate } from './internal-types.js';

export function detectFlatFallbackBlocks(rootDir: string): BlockCandidate[] {
  return listChildDirectories(join(rootDir, 'src')).map((name) => ({ name, path: `src/${name}` }));
}
