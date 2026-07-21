import { defineConfig } from 'vitest/config';

// Scoped to this workspace's own tests only. Without an explicit include, vitest's default
// discovery sweeps every **/*.test.ts[x] under this directory — which, since Task 7 added
// extension/webview/ as a nested npm workspace with its own test suite (jsdom environment,
// React Flow-specific polyfills in webview/test/setup.ts), silently pulled webview's tests
// into extension's own 'node'-environment run too, failing them all with unrelated DOM
// errors. Each workspace runs its own tests independently; this stops them colliding.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
