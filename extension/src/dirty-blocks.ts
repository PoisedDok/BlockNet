// Pure, vscode-free aggregation (Layer 3, docs/architecture/LAYERS.md) — split out from
// git.ts specifically so this, the actual bug-prone part (path-prefix matching), is
// unit-testable (extension/test/dirty-blocks.test.ts). git.ts itself imports the real
// `vscode` module (resolving the built-in git extension is only reachable through the real
// `vscode.extensions` namespace, not an injectable parameter the way state.ts/cache-bridge.ts
// inject a narrow vscode.Memento-shaped type), and vitest has no `vscode` mock configured —
// every other file that imports `vscode` directly (watcher.ts, panel.ts,
// show-architecture.ts) has zero unit tests for the same reason, verified manually instead.

/**
 * Which of `blocks`' ids have at least one dirty file under their path. Path-prefix match
 * (`dirtyFile === block.path || dirtyFile.startsWith(block.path + '/')`) — matches core's own
 * path convention (`BlockNode.path` is always POSIX-relative to rootDir, `BlockNode.id` is
 * always identical to `BlockNode.path`, confirmed in `core/src/blocks/detect.ts`). A
 * directory-boundary check, not a naive `startsWith(block.path)` — without the trailing-`/`
 * requirement, block path `apps/web` would wrongly also match a sibling directory
 * `apps/web-utils/foo.ts`.
 *
 * Known, accepted limitation: the synthetic `'(root)'` catch-all block (files matching no
 * detected block, `core/src/edges/resolve-block.ts`'s `ROOT_BLOCK_ID`, not exported from
 * core's public barrel) never matches here — a dirty top-level file with no owning block never
 * lights up `(root)`'s marker. Replicating core's own block-resolution cascade here to close
 * that gap would duplicate Layer 1 logic in Layer 4, a real drift risk for a cosmetic marker;
 * not attempted for v1.
 */
export function dirtyBlockIds(blocks: { id: string; path: string }[], dirtyFiles: string[]): Set<string> {
  const result = new Set<string>();
  for (const block of blocks) {
    const prefix = `${block.path}/`;
    if (dirtyFiles.some((f) => f === block.path || f.startsWith(prefix))) result.add(block.id);
  }
  return result;
}
