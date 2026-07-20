import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// Bundles the extension HOST only (docs/architecture/DIRECTORY-TREE.md) — the webview
// (extension/webview/, arriving with Task 7) is a separate vite build, never touched here.
//
// src/extension.ts → dist/extension.js: the VS Code extension host bundle (`main`), `vscode`
// external (provided by the host at runtime, never bundled). CommonJS — extension/package.json
// has no "type": "module", so a plain .js file here is loaded as CJS by Node/VS Code.
//
// dist/ipc-worker.mjs is NOT built by this file. It's copied verbatim from
// @blocknet/core's OWN build output (../core/dist/ipc-worker.js, produced by core's tsup
// config — must run first; the root build script already orders "core" before "extension").
// Two reasons this is a copy, not a re-bundle:
//   1. dependency-cruiser (a transitive import of analyze()) uses top-level await in some of
//      its own source files, which esbuild cannot lower into the CJS format used for
//      extension.js — and re-bundling ipc-worker.ts as ESM here hit a second, unrelated
//      esbuild-specific resolution failure in one of dependency-cruiser's optional
//      integrations (tsconfig-paths-webpack-plugin's deep import of
//      enhanced-resolve/lib/createInnerCallback, which doesn't exist in the installed
//      enhanced-resolve version) that tsup's bundler already tolerates correctly.
//   2. Reusing the artifact core's own build already produces and already tests
//      (core/test/ipc-worker.test.ts forks this exact file) means this file is verified once,
//      not twice, by two different bundlers that might silently diverge on edge cases.
// Renamed .js → .mjs on copy: it lands inside extension/dist/, which has no "type": "module"
// of its own, so a plain .js there would be parsed as CJS — this file's ESM syntax would be
// a runtime syntax error without the explicit extension forcing ESM regardless.
function copyIpcWorker() {
  const source = resolve(import.meta.dirname, '../core/dist/ipc-worker.js');
  if (!existsSync(source)) {
    throw new Error(`${source} does not exist — run \`npm run build --workspace=core\` first.`);
  }
  mkdirSync(resolve(import.meta.dirname, 'dist'), { recursive: true });
  copyFileSync(source, resolve(import.meta.dirname, 'dist/ipc-worker.mjs'));
  if (existsSync(`${source}.map`)) {
    copyFileSync(`${source}.map`, resolve(import.meta.dirname, 'dist/ipc-worker.mjs.map'));
  }
}

async function main() {
  await build({
    bundle: true,
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    outdir: 'dist',
    format: 'cjs',
    entryPoints: { extension: 'src/extension.ts' },
    external: ['vscode'],
  });
  copyIpcWorker();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
