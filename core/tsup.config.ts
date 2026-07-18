import { defineConfig } from 'tsup';

// Two entrypoints for now: the public API barrel and the CLI. `ipc-worker.ts` is added in
// Task 5 (docs/architecture/LAYERS.md) once the extension host has something to fork.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
});
