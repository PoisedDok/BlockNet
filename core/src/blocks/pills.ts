// Tech-pill derivation (docs/architecture/DIRECTORY-TREE.md). Pills reflect a block's real
// declared dependencies — not a curated allowlist — so they stay honest as a repo's deps
// change. `devDependencies` are included alongside `dependencies`: build-time tooling
// (e.g. `tailwindcss`) is as real a signal of a block's tech stack as a runtime import.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type PackageJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

// Distinguishes "no package.json here" (fine to fall back to the repo root's — the flat-repo
// strategy's blocks never have their own) from "a package.json exists but is corrupt" (must
// NOT fall back — silently attributing the root's unrelated dependencies to this block would
// misrepresent its tech stack, worse than showing none at all).
function readPackageJson(dir: string): { exists: boolean; pkg?: PackageJson } {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return { exists: false };
  try {
    return { exists: true, pkg: JSON.parse(readFileSync(path, 'utf-8')) as PackageJson };
  } catch {
    return { exists: true };
  }
}

// A corrupted merge or bad codegen can leave `dependencies`/`devDependencies` as something
// other than an object (an array, a string, ...). Object.keys() on those yields numeric
// index strings ("0", "1", ...) that would otherwise surface as fake pills — a silent truth
// violation, not a crash, so it's worth guarding explicitly rather than trusting the shape.
function depNames(value: unknown): string[] {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
}

export function derivePills(blockDir: string, rootDir: string): string[] {
  const own = readPackageJson(blockDir);
  const pkg = own.exists ? own.pkg : readPackageJson(rootDir).pkg;
  if (!pkg) return [];

  const names = new Set([...depNames(pkg.dependencies), ...depNames(pkg.devDependencies)]);
  return [...names].sort();
}
