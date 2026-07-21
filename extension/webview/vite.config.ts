/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Own build, separate from esbuild.config.ts (which bundles the extension host) — see
// docs/architecture/DIRECTORY-TREE.md. Output lands in dist/, packaged into the .vsix;
// extension/.vscodeignore excludes webview/src/** but not webview/dist/**.
export default defineConfig({
  plugins: [react()],
  // Default (root-absolute '/assets/...') paths don't resolve under a vscode-webview:// URI,
  // which isn't served from '/' — confirmed directly against the built output. Relative paths
  // resolve correctly once panel.ts injects a <base> tag pointing at the real webview URI, and
  // that's true for every asset the build emits (including the CSS's own @font-face url()s),
  // not just the ones referenced from index.html — no per-asset rewriting needed in panel.ts.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    // happy-dom was tried first (it advertises ResizeObserver/DOMMatrixReadOnly support) but
    // its vitest environment integration didn't expose a working `document` global at all in
    // this toolchain (confirmed directly: every render() call failed with "document is not
    // defined") — jsdom plus the targeted polyfills in test/setup.ts is the toolchain that
    // actually works here.
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    css: false,
  },
});
