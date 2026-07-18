// Strategy 2 of the block-detection cascade (docs/decisions/0005-blocks-auto-detected.md):
// one block per second-level directory under any top-level `apps/`, `packages/`,
// `services/`, `libs/`, or `infra/` folder — e.g. `apps/web`, `services/gateway`. Runs only
// when strategy 1 (workspaces.ts) found nothing; see detect.ts for the cascade order.
import { join } from 'node:path';
import { listChildDirectories } from './fs-utils.js';
import type { BlockCandidate } from './internal-types.js';

const CONVENTIONAL_FOLDERS = ['apps', 'packages', 'services', 'libs', 'infra'];

export function detectConventionalBlocks(rootDir: string): BlockCandidate[] {
  const candidates: BlockCandidate[] = [];

  for (const folder of CONVENTIONAL_FOLDERS) {
    for (const name of listChildDirectories(join(rootDir, folder))) {
      candidates.push({ name, path: `${folder}/${name}` });
    }
  }

  return candidates;
}
