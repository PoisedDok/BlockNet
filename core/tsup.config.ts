import { defineConfig } from 'tsup';

// Four entrypoints: the public API barrel, the CLI, the forked IPC worker
// (docs/architecture/PROCESS-BOUNDARY.md) that extension/src/analysis-runner.ts forks
// (Task 6, docs/architecture/LAYERS.md), and path-utils as its own dedicated entry (src/
// index.ts's header comment explains why: it must stay importable without pulling in
// analyze.ts's dependency-cruiser graph, which extension/src/watcher.ts — bundled into a
// CJS target — cannot tolerate).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'ipc-worker': 'src/ipc-worker.ts',
    'path-utils': 'src/path-utils.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Each entry fully self-contained, no shared chunk files between them. Needed because
  // extension/esbuild.config.ts copies dist/ipc-worker.js out of this directory in isolation
  // (renamed to .mjs) rather than the whole dist/ tree — a shared chunk (tsup's default when
  // multiple entries import overlapping code, e.g. every entry touches analyze.ts's graph)
  // would silently break that copy: ipc-worker.js would still `import` a sibling chunk file
  // that never made the trip, producing an ERR_MODULE_NOT_FOUND at fork() time, not build
  // time — confirmed empirically while wiring Task 6, not a theoretical concern.
  splitting: false,
});
