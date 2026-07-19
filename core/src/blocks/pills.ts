// Tech-pill derivation (docs/architecture/DIRECTORY-TREE.md). Pills reflect a block's real
// declared dependencies — not a curated allowlist — so they stay honest as a repo's deps
// change. `devDependencies` are included alongside `dependencies`: build-time tooling
// (e.g. `tailwindcss`) is as real a signal of a block's tech stack as a runtime import.
import { hasOtherLanguageManifest, readPackageJson } from './fs-utils.js';

type PackageJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

// A corrupted merge or bad codegen can leave `dependencies`/`devDependencies` as something
// other than an object (an array, a string, ...). Object.keys() on those yields numeric
// index strings ("0", "1", ...) that would otherwise surface as fake pills — a silent truth
// violation, not a crash, so it's worth guarding explicitly rather than trusting the shape.
function depNames(value: unknown): string[] {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
}

function pillsFrom(pkg: Record<string, unknown>): string[] {
  const typed = pkg as PackageJson;
  const names = new Set([...depNames(typed.dependencies), ...depNames(typed.devDependencies)]);
  return [...names].sort();
}

export function derivePills(blockDir: string, rootDir: string): string[] {
  const own = readPackageJson(blockDir);
  if (own.exists) return own.pkg ? pillsFrom(own.pkg) : [];

  // No package.json in this block. If it owns a different language's manifest (a block
  // other-languages.ts detected), it's a real project of its own — falling back to the repo
  // root's package.json would misattribute an unrelated JS project's dependencies as this
  // block's tech stack. The root fallback below is only correct for the flat-repo strategy's
  // blocks, which own no manifest of any kind.
  if (hasOtherLanguageManifest(blockDir)) return [];

  const rootPkg = readPackageJson(rootDir);
  return rootPkg.pkg ? pillsFrom(rootPkg.pkg) : [];
}
