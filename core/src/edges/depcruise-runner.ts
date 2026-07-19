// Invokes dependency-cruiser's in-process API (docs/decisions/0003). Binding exclude
// config (node_modules, dist, build, out, coverage, and — critically — every dot-directory)
// applies regardless of the target repo's own .gitignore — see the ADR for why this isn't
// optional. Dot-directories are excluded as a category, not enumerated by name: a real-repo
// run against `aetherinc` (a Next.js app) found `.next/` — 345 generated files — leaking
// into the graph as if it were source, because the original list only named `dist`,
// `build`, `out`, `coverage`. Every current or future framework's build/cache output
// (`.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.cache`, `.vercel`, ...) is caught by the
// same rule. The pattern itself lives in path-utils.ts's `EXCLUDE_PATTERN_SOURCE` — the
// single shared definition also used by file-walk.ts's generic all-languages file inventory
// and referenced by blocks/fs-utils.ts's `listChildDirectories` — so the pipeline's several
// consumers of "what counts as source" can't silently drift apart from each other again.
//
// Path aliases (tsconfig `paths`) are resolved by BlockNet itself, not handed to
// dependency-cruiser's own `tsConfig` cruise option: dependency-cruiser's
// tsconfig-paths-webpack-plugin resolves `paths` relative to `process.cwd()`, not the
// `baseDir` cruise option — confirmed by direct testing (see docs/planning/PROGRESS.md's
// Task 3 entry). `analyze()` can be invoked from any cwd (a forked ipc-worker.ts process
// inherits the extension host's cwd, not the analyzed repo's), so relying on it would
// silently break every aliased import whenever cwd !== rootDir — a false-negative edge,
// exactly as fatal to trust as a false positive (docs/PRINCIPLES.md). Instead, `paths` /
// `baseUrl` are read directly and translated into enhanced-resolve's `alias` resolve
// option with fully-resolved absolute targets, which is cwd-independent. This is config
// translation, not a second resolver — enhanced-resolve (already inside
// dependency-cruiser) still does 100% of the actual resolution work, matching the ADR's
// "we write the aggregator, not the parser" premise.
//
// `tsPreCompilationDeps: true` is likewise binding, not a tuning knob: without it,
// dependency-cruiser silently drops any import whose binding is never referenced in the
// importing file (TypeScript elides unused imports before dependency-cruiser's extractor
// ever sees them) — confirmed by direct testing. A real, unused-but-present import is still
// a real architectural dependency; silently dropping it is a false negative.
//
// `rootDir` is resolved to its real path before use: dependency-cruiser resolves
// dependencies through `fs.realpath` internally, but leaves the `baseDir` option itself
// unresolved. If `rootDir` (or an ancestor of it) is a symlink — macOS's own `os.tmpdir()`
// always is (`/var/folders` → `/private/var/folders`); so are some real dev setups
// (dotfiles-managed home directories, certain container mounts) — the two diverge and a
// single file gets reported as two different modules under two different relative paths,
// splitting its real edges across a "ghost" module that never resolves back to a block.
// Confirmed by direct testing (see docs/planning/PROGRESS.md's Task 3 entry).
import { realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { cruise, type ICruiseResult } from 'dependency-cruiser';
import { createLogger, type Logger } from '../log.js';
import { EXCLUDE_PATTERN_SOURCE, isWithinRoot } from '../path-utils.js';
import { readTsconfigJsonc } from '../tsconfig-utils.js';

type TsconfigPaths = {
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
};

/**
 * Translates tsconfig `paths` into an enhanced-resolve `alias` map with absolute targets.
 * Only the single-trailing-`/*` shape is supported (matches blocks/workspaces.ts's own
 * documented scope limit for workspace globs) — a `paths` entry in any other shape is
 * skipped, not guessed at.
 */
function deriveAliases(rootDir: string, logger: Logger): Record<string, string> {
  const tsconfigPath = join(rootDir, 'tsconfig.json');
  const parsed = readTsconfigJsonc(tsconfigPath, logger) as TsconfigPaths | undefined;
  const paths = parsed?.compilerOptions?.paths;
  if (!paths) return {};

  const baseUrl = resolve(rootDir, parsed?.compilerOptions?.baseUrl ?? '.');
  const alias: Record<string, string> = {};

  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (!key.endsWith('/*') || !target || !target.endsWith('/*')) {
      logger.warn(`${tsconfigPath}: paths entry "${key}" is not a single trailing "/*" pattern, skipping`);
      continue;
    }

    const resolvedTarget = resolve(baseUrl, target.slice(0, -2));
    // A `paths` target that climbs out of rootDir (`../../shared/*`) would otherwise hand
    // enhanced-resolve an alias pointing outside the analyzed tree — the same class of
    // escape blocks/fs-utils.ts already guards against for workspace/tsconfig-reference
    // candidates (docs/planning/PROGRESS.md's Task 2 entry). Explicit, not incidental: this
    // does NOT rely on EXCLUDE_PATTERN's dot-directory matching happening to also catch `..`
    // segments — that overlap is coincidental, not a documented guarantee, and would silently
    // stop holding if EXCLUDE_PATTERN is ever tightened.
    const relativeToRoot = relative(rootDir, resolvedTarget).split('\\').join('/');
    if (!isWithinRoot(relativeToRoot)) {
      logger.warn(`${tsconfigPath}: paths entry "${key}" resolves outside rootDir, skipping`);
      continue;
    }

    alias[key.slice(0, -2)] = resolvedTarget;
  }

  return alias;
}

export async function runDependencyCruise(
  rootDir: string,
  logger: Logger = createLogger(),
): Promise<ICruiseResult> {
  const realRootDir = realpathSync(rootDir);
  const alias = deriveAliases(realRootDir, logger);

  const result = await cruise(
    ['.'],
    {
      baseDir: realRootDir,
      exclude: { path: EXCLUDE_PATTERN_SOURCE },
      tsPreCompilationDeps: true,
      outputType: 'json',
    },
    Object.keys(alias).length > 0 ? { alias } : {},
  );

  return typeof result.output === 'string' ? (JSON.parse(result.output) as ICruiseResult) : result.output;
}
