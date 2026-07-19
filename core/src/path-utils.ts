// Shared path-containment predicate. Used by blocks/fs-utils.ts (workspace/tsconfig-
// reference candidates) and edges/{depcruise-runner,file-graph}.ts (resolved import
// targets) so a path-escape bug fixed once for block detection (docs/planning/PROGRESS.md's
// Task 2 entry — a sibling-project reference like `../shared`, ordinary when only a
// subdirectory of a larger monorepo is open) can't silently reappear, unguarded, in a
// sibling module that computes the same class of check independently. Confirmed as a real,
// not hypothetical, gap during Task 3's review: a plain relative import climbing out of
// rootDir (`../../outside/thing.ts`) resolved and leaked into the file graph with no guard
// at all, attributing a filesystem path outside the analyzed root to the `(root)` block.

/**
 * True if `posixRelativePath` (already POSIX-separated, already relative to some root)
 * stays within that root — not empty, not `..`, doesn't start with a `../` segment, and
 * isn't absolute.
 */
export function isWithinRoot(posixRelativePath: string): boolean {
  return (
    posixRelativePath !== '' &&
    posixRelativePath !== '..' &&
    !posixRelativePath.startsWith('../') &&
    !posixRelativePath.startsWith('/')
  );
}

// The single definition of "not real source" for the whole pipeline: node_modules, build/cache
// output (dist/build/out/coverage, and — critically — every dot-directory, since every current
// or future framework's own build/cache dir, `.next`/`.nuxt`/`.svelte-kit`/`.turbo`/`.cache`/
// `.vercel`/..., is caught by the same rule rather than an ever-growing enumerated list).
// `target`/`__pycache__`/`venv`/`vendor` cover the equivalent build/dependency-output
// convention for the other languages block detection now recognizes (docs/decisions/0005's
// 2026-07-19 amendment): a real-repo run against a Rust project (`Cargo.toml` as a host
// signal) found its `target/` directory — 131,144 files, Cargo's full dependency build
// output — counted as if it were source, the exact same failure class `.next/` was for JS
// before this pattern existed; recognizing a language as a block-detection host without also
// excluding its build output is only half the fix. Exported as a STRING (not just a
// predicate) because edges/depcruise-runner.ts must hand this exact pattern to
// dependency-cruiser's own `exclude.path` option — dependency-cruiser compiles it internally,
// so we can't hand it a JS predicate instead. file-walk.ts (the generic all-languages file
// inventory used for fileCount) derives its own predicate from this same string via
// `isExcludedPath` below. A real-repo run once found `.next/`'s 345 generated files leaking
// into the graph because two separately-maintained copies of "what to exclude" had silently
// drifted apart; sharing one definition here is what keeps that from happening again.
export const EXCLUDE_PATTERN_SOURCE =
  '(^|/)(node_modules|dist|build|out|coverage|target|__pycache__|venv|vendor|\\.[^/]+)(/|$)';

const EXCLUDE_PATTERN = new RegExp(EXCLUDE_PATTERN_SOURCE);

/** True if `posixRelativePath` (relative to some root, already POSIX-separated) falls under
 * node_modules, a build/cache output directory, or any dot-directory anywhere in its path. */
export function isExcludedPath(posixRelativePath: string): boolean {
  return EXCLUDE_PATTERN.test(posixRelativePath);
}
