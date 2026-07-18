// Tech-pill derivation (docs/architecture/DIRECTORY-TREE.md). Pills reflect a block's real
// declared dependencies — not a curated allowlist — so they stay honest as a repo's deps
// change. `devDependencies` are included alongside `dependencies`: build-time tooling
// (e.g. `tailwindcss`) is as real a signal of a block's tech stack as a runtime import.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type PackageJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

function readPackageJson(dir: string): PackageJson | undefined {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PackageJson;
  } catch {
    return undefined;
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
  const pkg = readPackageJson(blockDir) ?? readPackageJson(rootDir);
  if (!pkg) return [];

  const names = new Set([...depNames(pkg.dependencies), ...depNames(pkg.devDependencies)]);
  return [...names].sort();
}
