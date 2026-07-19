// Shared filesystem helpers for the block-detection cascade. Centralized so the
// symlink-following and root-containment rules below apply identically to every strategy —
// see docs/planning/PROGRESS.md's Task 2 entry for the real-repo bugs this exists to close.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isExcludedPath, isWithinRoot } from '../path-utils.js';

// `Dirent.isDirectory()` (from readdirSync's withFileTypes) does NOT follow symlinks — a
// symlinked workspace member (pnpm-style linking, Nx/Bazel-generated layouts) would
// otherwise silently vanish from every strategy. `statSync` always follows symlinks, which
// is the correct, consistent behavior everywhere a candidate directory is considered.
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Names of `dir`'s child directories (symlinks followed), skipping anything
 * `path-utils.ts`'s shared `isExcludedPath` rules out (node_modules, build/dependency output
 * — `dist`/`build`/`out`/`coverage`/`target`/`__pycache__`/`venv`/`vendor` — and every
 * dot-directory). Tested against each entry's bare name, not a full relative path: the
 * pattern's `(^|/)...(/|$)` anchors make a bare segment name behave identically to a
 * single-segment path, so this doesn't need `dir`'s position relative to rootDir. Sharing this
 * with edges/depcruise-runner.ts and file-walk.ts closes a real gap found after Checkpoint A's
 * multi-language work: without it, every block-detection strategy that walks directories
 * through this function — structural.ts's host search chief among them — could still find a
 * `package.json` vendored inside a `vendor/`/`dist`/`target` tree and mistake it for a real
 * project, the same cascade-hijacking failure class a manifest-vocabulary widening alone
 * doesn't close. Returns `[]` if `dir` doesn't exist or can't be read (missing, not a
 * directory, or permission-denied — a locked-down mount or root-owned build artifact must
 * degrade the cascade to its next strategy, never crash the whole analysis).
 */
export function listChildDirectories(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !isExcludedPath(e.name))
    .filter((e) => e.isDirectory() || (e.isSymbolicLink() && isDirectory(join(dir, e.name))))
    .map((e) => e.name);
}

/** Whether `dir` is itself a self-contained JS/TS project — the one shared "is this a real
 * project, or just a container folder" signal every block-detection strategy that needs it
 * (workspaces.ts, structural.ts) should use, so the definition never quietly forks. Kept
 * JS/TS-specific because npm/yarn "workspaces" is inherently a `package.json` concept — a
 * workspace member without one isn't a real member, regardless of what other manifests happen
 * to sit near it. Non-JS project detection is a separate, deliberately additive concern —
 * see `hasOtherLanguageManifest` below and `other-languages.ts`. */
export function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, 'package.json'));
}

// Recognized project manifests for languages other than JS/TS. Block *detection* is
// language-agnostic on purpose (docs/decisions/0005's 2026-07-19 amendment) — a Python or Go
// sub-project is a real architectural unit even though v1's import/edge analysis stays
// TS/JS-only (docs/decisions/0004, unchanged by this). `Dockerfile` is included deliberately:
// a directory whose only manifest is a Dockerfile (a containerized service with no other
// ecosystem's package file) is still a real, deployable unit worth surfacing as its own block.
const OTHER_LANGUAGE_MANIFESTS = [
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Dockerfile',
];

/** Whether `dir` owns a recognized project manifest for a language other than JS/TS — the
 * host signal for `other-languages.ts`'s additive, top-level-only block-detection step, and
 * the gate `pills.ts` checks before deciding whether its root-package.json fallback applies. */
export function hasOtherLanguageManifest(dir: string): boolean {
  return OTHER_LANGUAGE_MANIFESTS.some((name) => existsSync(join(dir, name)));
}

/**
 * `absDir` as a POSIX-style path relative to `rootDir`, or `undefined` if `absDir` IS
 * `rootDir` (an empty path can't be a block id) or escapes `rootDir` entirely (a workspace
 * pattern or tsconfig reference pointing outside the analyzed root — e.g. `../shared`, or a
 * sibling project when only a subdirectory of a larger monorepo is open). A block path that
 * starts with `..` can never match a file under `rootDir` (Task 3's file-to-block
 * resolution is rootDir-scoped) and would leak a raw filesystem path outside the analyzed
 * root into `GraphResult`, which crosses the process boundary — so it's never a valid
 * candidate, not even a low-confidence one.
 */
export function toBlockRelativePath(rootDir: string, absDir: string): string | undefined {
  const rel = relative(rootDir, absDir).split('\\').join('/');
  return isWithinRoot(rel) ? rel : undefined;
}

export type JsonObject = Record<string, unknown>;

/**
 * Reads and parses `dir`'s `package.json`, loosely typed — each call site casts to whatever
 * narrow shape it actually needs (pills.ts's dependencies/devDependencies, risks/boundary.ts's
 * main/exports). Distinguishes "no package.json here" (`exists: false`, fine to degrade
 * differently per caller) from "a package.json exists but is corrupt" (`exists: true, pkg:
 * undefined` — callers must NOT silently treat this the same as "no manifest at all"; see
 * pills.ts's fallback-gate comment for why that distinction is load-bearing). Shared here
 * after the same read-and-degrade logic started drifting into a second copy for boundary.ts.
 */
export function readPackageJson(dir: string): { exists: boolean; pkg?: JsonObject } {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return { exists: false };
  try {
    return { exists: true, pkg: JSON.parse(readFileSync(path, 'utf-8')) as JsonObject };
  } catch {
    return { exists: true };
  }
}
