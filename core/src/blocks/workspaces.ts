// Strategy 1 of the block-detection cascade (docs/decisions/0005-blocks-auto-detected.md):
// npm/yarn `package.json` workspaces and/or tsconfig.json project references. Candidates
// from both sources are merged (deduped by resolved relative-path string, so `./packages/x`,
// `packages/x`, and `packages/x/` all collapse to one) so a repo using either — or both,
// pointing at the same package — produces one block per real project, not per source.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { createLogger, type Logger } from '../log.js';
import { isDirectory, listChildDirectories, toBlockRelativePath } from './fs-utils.js';
import type { BlockCandidate } from './internal-types.js';

type PackageJson = { name?: string; workspaces?: string[] | { packages?: string[] } };
type TsconfigReferences = { references?: Array<{ path?: string }> };

function readJsonSafe<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

function nameFromPackageJson(dir: string, fallback: string): string {
  const pkg = readJsonSafe<PackageJson>(join(dir, 'package.json'));
  return pkg?.name ?? fallback;
}

function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, 'package.json'));
}

function workspacePatterns(pkg: PackageJson | undefined): string[] {
  if (!pkg?.workspaces) return [];
  return Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces.packages ?? []);
}

function addCandidate(found: Map<string, BlockCandidate>, rootDir: string, memberDir: string, fallbackName: string) {
  const path = toBlockRelativePath(rootDir, memberDir);
  if (path === undefined) return;
  found.set(path, { name: nameFromPackageJson(memberDir, fallbackName), path });
}

function candidatesFromWorkspaces(rootDir: string): Map<string, BlockCandidate> {
  const found = new Map<string, BlockCandidate>();
  const pkg = readJsonSafe<PackageJson>(join(rootDir, 'package.json'));

  for (const pattern of workspacePatterns(pkg)) {
    // Only a single trailing `/*` (one level) is supported — the overwhelming majority of
    // real npm/yarn workspace configs use exactly this shape. Deeper globs are out of scope
    // for v1; revisit if Checkpoint A's real repos need it.
    if (pattern.endsWith('/*')) {
      const baseDir = resolve(rootDir, pattern.slice(0, -2));
      for (const name of listChildDirectories(baseDir)) {
        const memberDir = join(baseDir, name);
        if (!hasPackageJson(memberDir)) continue;
        addCandidate(found, rootDir, memberDir, name);
      }
    } else {
      const memberDir = resolve(rootDir, pattern);
      if (!isDirectory(memberDir) || !hasPackageJson(memberDir)) continue;
      addCandidate(found, rootDir, memberDir, basename(memberDir));
    }
  }

  return found;
}

function candidatesFromTsconfigReferences(rootDir: string, logger: Logger): Map<string, BlockCandidate> {
  const found = new Map<string, BlockCandidate>();
  const tsconfigPath = join(rootDir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return found;

  let parsed: TsconfigReferences;
  try {
    const errors: ParseError[] = [];
    parsed = parseJsonc(readFileSync(tsconfigPath, 'utf-8'), errors, {
      allowTrailingComma: true,
    }) as TsconfigReferences;
    // jsonc-parser recovers a best-effort tree even when part of the file has an unrelated
    // error (e.g. a missing comma inside compilerOptions) — `references` itself frequently
    // still parses correctly. Bailing on ANY error would silently downgrade a real monorepo
    // to a weaker cascade strategy over a typo nowhere near the field that matters, so this
    // only warns; each individual reference is still validated below (must resolve to a real
    // directory inside rootDir) before it's trusted.
    if (errors.length > 0) {
      logger.warn(`${tsconfigPath}: JSONC parse produced ${errors.length} error(s), best-effort recovery used`);
    }
  } catch {
    logger.warn(`${tsconfigPath}: failed to parse, skipping project references`);
    return found;
  }

  for (const ref of parsed.references ?? []) {
    if (!ref.path) continue;
    let refDir = resolve(rootDir, ref.path);
    if (refDir.endsWith('.json')) refDir = dirname(refDir);
    if (!isDirectory(refDir)) continue;
    addCandidate(found, rootDir, refDir, basename(refDir));
  }

  return found;
}

export function detectWorkspaceBlocks(rootDir: string, logger: Logger = createLogger()): BlockCandidate[] {
  const merged = new Map<string, BlockCandidate>([
    ...candidatesFromWorkspaces(rootDir),
    ...candidatesFromTsconfigReferences(rootDir, logger),
  ]);
  return [...merged.values()];
}
