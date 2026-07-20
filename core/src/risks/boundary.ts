// BOUNDARY risk detection (docs/decisions/0006): a file in block A imports a path of block B
// that is not one of B's declared entry points — every subpath key in B's package.json
// `exports` map (all leaves, including nested condition objects like import/require/types)
// when one exists, else `main` when it exists, else B's own conventional index file.
//
// "Conventional index file" deliberately checks BOTH `<block>/index.*` and
// `<block>/src/index.*`, not literally just the block-root file a strict reading of
// ADR-0006's "index.ts" might suggest. A block-root-only search would misfire as BOUNDARY on
// nearly every real unbuilt TS/JS monorepo package (source conventionally lives under src/,
// not the package root) — exactly the false-positive-on-sight failure docs/PRINCIPLES.md
// treats as fatal, and confirmed against the real monorepo fixture built for this rule
// (packages/c has no main/exports, and its real entry is packages/c/src/index.ts, not
// packages/c/index.ts). See docs/decisions/0006's amendment for the precise algorithm.
//
// A `main`/`exports` leaf is resolved to the real file on disk the same way TypeScript/
// dependency-cruiser would (docs/decisions/0003): the literal path first, then the same path
// with a source extension swapped in (a `main: "./dist/index.js"` field commonly points at
// build output that doesn't exist in an unbuilt source tree — only the .ts sibling does),
// then as a directory needing its own index file. This is intentionally a small, bounded
// resolver, not a second bundler — dependency-cruiser already did the hard resolution work
// for FileEdge.targetFile; this only needs to answer "does this package.json-declared path
// point at the same real file," which is a much narrower question.
//
// An `exports` leaf containing `*` (e.g. `"./*": "./src/*.ts"`) is Node's wildcard-subpath
// form — a mainstream pattern for intentionally exposing an entire subtree at once, not an
// exotic case (confirmed as a real false-positive during Task 4's adversarial review: without
// this, a package using this exact shape had every deep import through it flagged BOUNDARY,
// the false-positive-on-sight failure docs/PRINCIPLES.md treats as fatal). `*` is handled as
// a pattern matched directly against the already-resolved FileEdge.targetFile, not resolved
// via existsSync — Node's own semantics let `*` match one-or-more path segments (including
// further slashes), so there's no single real file to search for; the wildcard leaf itself
// already fully determines which real files qualify, without needing filesystem existence
// checks or the built-output extension-swap fallback literal leaves need.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { hasPackageJson, readPackageJson, toBlockRelativePath } from '../blocks/fs-utils.js';
import { ROOT_BLOCK_ID, resolveBlock } from '../edges/resolve-block.js';
import type { BlockNode, FileEdge } from '../types.js';

type PackageJsonEntries = { main?: unknown; exports?: unknown };

// Every extension dependency-cruiser actually parses as TS/JS-compatible with
// tsPreCompilationDeps: true (edges/depcruise-runner.ts always passes this option) —
// verified directly against dependency-cruiser's own TS_COMPATIBLE_EXTENSIONS list. `.mts`/
// `.cts` (Node's native ESM/CJS TypeScript extensions — a real vite.config.mts is mainstream,
// not exotic) were missing here originally; mirrored in cache/manifest.ts's
// SOURCE_EXTENSIONS, which had the identical gap (see docs/planning/PROGRESS.md's Task 5
// entry for the real stale-cache bug that gap caused).
const RESOLVABLE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Resolves a package.json-declared path (e.g. "./index.js", "./dist", "./src/index") to the
 * real file on disk it refers to, trying the literal path, then common source-extension
 * swaps, then treating it as a directory needing its own index file. Returns `undefined` if
 * none of those exist — a declared entry pointing at nothing real can't be a valid boundary. */
function resolveDeclaredPath(baseDir: string, declaredPath: string): string | undefined {
  const cleaned = declaredPath.replace(/^\.\//, '');
  const withoutKnownExt = cleaned.replace(/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/, '');

  for (const ext of RESOLVABLE_EXTENSIONS) {
    const candidate = join(baseDir, withoutKnownExt + ext);
    if (isFile(candidate)) return candidate;
  }
  for (const ext of RESOLVABLE_EXTENSIONS.slice(1)) {
    const candidate = join(baseDir, cleaned, `index${ext}`);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Converts a package.json-declared path relative to `block`, containing exactly one `*`, into
 * a RegExp matching the POSIX path (relative to rootDir) it stands for. `*` maps to one-or-more
 * characters (Node's own exports-wildcard semantics), which may itself include further `/`s. */
function wildcardToPattern(blockPath: string, declaredPath: string): RegExp {
  const cleaned = declaredPath.replace(/^\.\//, '');
  const fullRelPath = `${blockPath}/${cleaned}`;
  const escaped = fullRelPath.split('*').map(escapeRegExp).join('.+');
  return new RegExp(`^${escaped}$`);
}

/** Recursively collects every string leaf in a package.json `exports` value — a single
 * string, an array, a flat subpath map ("./utils": "./src/utils.ts"), or nested condition
 * objects ({"import": ..., "require": ..., "types": ...}) at any depth. */
function collectExportLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectExportLeaves);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(collectExportLeaves);
  return [];
}

type DeclaredEntries = { files: Set<string>; patterns: RegExp[] };

function isDeclaredEntry(entries: DeclaredEntries, targetFile: string): boolean {
  return entries.files.has(targetFile) || entries.patterns.some((p) => p.test(targetFile));
}

/**
 * `block`'s declared public surface — the target-file comparison set for boundary checking.
 * `files` are exact matches; `patterns` come from wildcard `exports` leaves and are matched
 * directly against a FileEdge's already-resolved targetFile (see header comment for why
 * wildcards skip the filesystem-resolution path literal leaves go through).
 */
function declaredEntryFiles(rootDir: string, block: BlockNode): DeclaredEntries {
  const baseDir = join(rootDir, block.path);
  const { pkg } = readPackageJson(baseDir);
  const typed = pkg as PackageJsonEntries | undefined;

  let candidates: string[];
  if (typed?.exports !== undefined) {
    // exports fully replaces main once present — Node module resolution semantics.
    candidates = collectExportLeaves(typed.exports);
  } else if (typeof typed?.main === 'string') {
    candidates = [typed.main];
  } else {
    // No exports, no main: try both the block-root and the src/-nested conventional index —
    // see this module's header comment for why both, not just the ADR text's literal reading.
    candidates = ['index', 'src/index'];
  }

  const files = new Set<string>();
  const patterns: RegExp[] = [];
  for (const candidate of candidates) {
    if (candidate.includes('*')) {
      patterns.push(wildcardToPattern(block.path, candidate));
      continue;
    }
    const resolved = resolveDeclaredPath(baseDir, candidate);
    if (!resolved) continue;
    const relPath = toBlockRelativePath(rootDir, resolved);
    if (relPath) files.add(relPath);
  }
  return { files, patterns };
}

/**
 * Returns exactly the FileEdges that cross a block boundary into a path that isn't part of
 * the target block's declared entry surface. Intra-block edges are never boundary concerns
 * (block-aggregate.ts already excludes them from the block-level Edge graph this attaches
 * to), and an edge whose target resolves to the synthetic "(root)" catch-all is never flagged
 * — root is an unclassified bucket, not an intentional architectural unit with a designed
 * public surface, and flagging imports "into" it would be exactly the flat-repo-fallback
 * noise docs/planning/PROGRESS.md's Tracked risks already names as a known false-positive
 * source, not a genuine encapsulation leak.
 *
 * The same reasoning applies, and is load-bearing, one level down: a target block that owns
 * NO package.json of its own — a flat-fallback block (docs/decisions/0005's strategy 3, "top-
 * level folders under src/") — is also never checked. It isn't a package with a designed
 * public API, just a directory grouping inside one single application; every file in it is
 * equally "internal" to the app, so there is no real boundary to violate. Confirmed as a real,
 * not hypothetical, bug during Checkpoint A validation: without this gate, EVERY crossing
 * import into a flat-fallback block was flagged — 100% of aetherinc's real edges (all 4)
 * came back BOUNDARY, the exact false-positive-on-sight failure docs/PRINCIPLES.md treats as
 * fatal. `hasPackageJson` is the same "is this a real self-contained project" signal
 * workspaces.ts/structural.ts already use, reused here rather than re-derived.
 */
export function findBoundaryViolations(fileEdges: FileEdge[], blocks: BlockNode[], rootDir: string): FileEdge[] {
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const entryCache = new Map<string, DeclaredEntries>();

  const violations: FileEdge[] = [];
  for (const edge of fileEdges) {
    const sourceBlockId = resolveBlock(edge.sourceFile, blocks);
    const targetBlockId = resolveBlock(edge.targetFile, blocks);
    if (sourceBlockId === targetBlockId) continue;
    if (targetBlockId === ROOT_BLOCK_ID) continue;

    const targetBlock = blocksById.get(targetBlockId);
    if (!targetBlock) continue;
    if (!hasPackageJson(join(rootDir, targetBlock.path))) continue;

    let entries = entryCache.get(targetBlockId);
    if (!entries) {
      entries = declaredEntryFiles(rootDir, targetBlock);
      entryCache.set(targetBlockId, entries);
    }

    if (!isDeclaredEntry(entries, edge.targetFile)) violations.push(edge);
  }
  return violations;
}
