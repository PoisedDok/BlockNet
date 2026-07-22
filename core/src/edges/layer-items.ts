// Computes the direct-children item set for one layer — repo root (layerPath === '') down
// through arbitrary directory depth (docs/planning/ROADMAP-V2.md's v2.0.1 "unified layer
// model"). This is the item-listing half of that feature; edges/layer-connections.ts is the
// edge-resolution half, deliberately separate (one produces WHAT is rendered, the other
// resolves WHICH connections are visible against whatever set this produces).
import { ROOT_BLOCK_ID, resolveBlock } from './resolve-block.js';
import type { BlockNode, LayerItemBoundary } from '../types.js';

// A block nested inside ANOTHER block's own directory (a real shape in this very repo:
// `extension/webview` is a registered block nested inside `extension`) never appears
// separately at the layer that block's own nearest-ancestor block would otherwise render at —
// it surfaces as one of THAT ancestor's own direct-child items once you drill into it.
// Deliberately NOT generalized to "nested inside any ancestor directory that itself has other
// content" (which would need synthesizing placeholder folder items for otherwise-empty
// intermediate directories, e.g. a hypothetical block at `a/b/c` where neither `a` nor `a/b`
// has any other content) — this mirrors VS Code's own "compact folders" convention (an
// intermediate directory with nothing else in it doesn't get its own row), not a gap: a block
// with no other-block ancestor renders at whichever layer its own path implies, absorbing any
// content-free intermediate segments above it.
//
// This must hold at EVERY layer a nested block could be reached from, not just root — a block
// nested one level deep (`extension/webview` under `extension`) has to surface specifically
// when diving into `extension`, not just be permanently excluded everywhere. `isStrictlyUnder`
// is the one primitive both `hasIntermediateBlock` (is some OTHER, more specific block sitting
// between `layerPath` and `block`?) and the injection filter below share, so root (`layerPath
// === ''`) and any deeper layer use the exact same rule — no separate root-only special case
// (a real bug this replaces: the original implementation only ever injected nested blocks at
// `layerPath === ''`, so `extension/webview` never appeared as an item at ANY layer at all —
// its files instead leaked into `resolveLayerConnections` as 13 separate dangling arrows off
// `extension/src` once you dove into `extension`, found via live verification against this
// repo's own real data, not a hypothetical).
function isStrictlyUnder(path: string, ancestorPath: string): boolean {
  return ancestorPath === '' ? path !== '' : path.startsWith(`${ancestorPath}/`);
}

function hasIntermediateBlock(block: BlockNode, blocks: BlockNode[], layerPath: string): boolean {
  return blocks.some(
    (other) =>
      other.id !== block.id &&
      other.id !== ROOT_BLOCK_ID &&
      other.path !== layerPath &&
      isStrictlyUnder(block.path, other.path) &&
      isStrictlyUnder(other.path, layerPath),
  );
}

/** Every block that should render as its own folder-item at `layerPath` — nested strictly
 * under it, with no shallower block sitting in between (the "compact folder" rule above,
 * generalized to any layer, not just root). */
function nestedBlockItemsFor(layerPath: string, blocks: BlockNode[]): LayerItemBoundary[] {
  return blocks
    .filter((b) => b.id !== ROOT_BLOCK_ID && isStrictlyUnder(b.path, layerPath) && !hasIntermediateBlock(b, blocks, layerPath))
    .map((b) => ({ id: b.id, path: b.path, isFolder: true }));
}

/** Groups `files` (already scoped to `layerPath`'s own files, see itemsForLayer) into direct
 * children: a file exactly one segment past `layerPath` becomes a file item; anything nested
 * two-plus segments past `layerPath` collapses into ONE folder item for the intermediate
 * directory, aggregating its whole subtree regardless of how deep the actual files inside it
 * go. The identical grouping rule at every layer — repo root, a block, or a plain
 * subdirectory — applied uniformly, unlike the block-nesting compaction above: a plain
 * folder does NOT absorb empty intermediate segments the same way (accepted asymmetry — real
 * blocks come from AD-5's own detection cascade and can legitimately nest arbitrarily deep;
 * grouping loose files doesn't need the same compaction to stay usable). */
function groupDirectChildren(files: string[], layerPath: string): LayerItemBoundary[] {
  const prefixLen = layerPath === '' ? 0 : layerPath.length + 1;
  const seenFiles = new Set<string>();
  const seenFolders = new Set<string>();
  const result: LayerItemBoundary[] = [];

  for (const file of files) {
    const rest = file.slice(prefixLen);
    const slashIndex = rest.indexOf('/');
    if (slashIndex === -1) {
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);
      result.push({ id: file, path: file, isFolder: false });
    } else {
      const firstSegment = rest.slice(0, slashIndex);
      if (seenFolders.has(firstSegment)) continue;
      seenFolders.add(firstSegment);
      const folderPath = layerPath === '' ? firstSegment : `${layerPath}/${firstSegment}`;
      result.push({ id: folderPath, path: folderPath, isFolder: true });
    }
  }

  return result;
}

/** `allFiles` is the whole-repo file list (walkRealFiles(rootDir), one call) — the same
 * primitive analyze-micro.ts's filesForBlock() uses, for the identical reason: a scoped walk
 * per layer would lose walkRealFiles()'s cross-call symlink dedup and could double-count a
 * physically-shared file two different scoped calls both see. Callers own that one walk;
 * this function is pure over its result. */
export function itemsForLayer(allFiles: string[], layerPath: string, blocks: BlockNode[]): LayerItemBoundary[] {
  const scopeId = resolveBlock(layerPath, blocks);
  const scopedFiles = allFiles.filter((file) => {
    if (resolveBlock(file, blocks) !== scopeId) return false;
    if (layerPath === '') return true;
    return file === layerPath || file.startsWith(`${layerPath}/`);
  });

  // Nested-block injection applies at EVERY layer, not just root — see nestedBlockItemsFor's
  // own header comment for the real bug this fixes. scopedFiles above already excludes a
  // nested block's own files (resolveBlock resolves each file to its OWN, most specific block,
  // never this layer's), so there is no risk of groupDirectChildren also producing a
  // colliding plain-folder item for the same path.
  const blockItems = nestedBlockItemsFor(layerPath, blocks);
  const childItems = groupDirectChildren(scopedFiles, layerPath);
  return [...blockItems, ...childItems];
}
