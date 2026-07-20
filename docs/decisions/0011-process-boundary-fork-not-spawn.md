# ADR-0011: Extension-to-core process boundary is child_process.fork(), not spawn+stdout

## Status
Accepted

## Date
2026-07-18

## Context
ADR-0008 established that analysis "runs in a child process, never on the extension host
thread" but left the actual IPC mechanism unspecified. That ambiguity would have caused
rework mid-implementation of the extension host — it needed resolving before Task 6, not
during it.

## Decision
`extension/src/analysis-runner.ts` uses `child_process.fork()` against a dedicated
`core/src/ipc-worker.ts` entrypoint — one-shot per analysis run (forked, runs one
`analyze()` call, sends its result, exits; not a long-lived worker).

## Alternatives Considered

### `child_process.spawn()` + stdout JSON-line parsing (reusing `cli.ts`)
- Pros: one fewer entrypoint file; `cli.ts` already exists for Task 1.
- Rejected: stdout is a shared, unstructured channel — a stray `console.log` anywhere in
  dependency-cruiser's transitive dependency tree corrupts the stream. Parsing JSON lines
  out of stdout is also strictly more code than `fork()`'s built-in
  `process.send()`/`on('message')` IPC channel.

### A long-lived forked worker, reused across analysis runs
- Pros: avoids fork overhead on every save.
- Rejected: analysis is infrequent (on-save, not on-keystroke), so fork overhead is
  irrelevant; a one-shot process avoids state leakage between runs and keeps the lifecycle
  trivial to reason about (fork → one message in → one message out → kill).

## Consequences
`cli.ts` (stdout/human contract) and `ipc-worker.ts` (structured IPC contract) are both thin
adapters over the same `analyze()` — see `docs/architecture/PROCESS-BOUNDARY.md` for the
full sequence diagram. Neither file may contain analysis logic; a bug found via the CLI
must be reproducible via the extension path and vice versa, because both call the identical
function.

## Amendment — 2026-07-20 (Task 6 implementation findings)

Building the actual fork wiring surfaced two build-level facts this ADR didn't anticipate,
both confirmed empirically (not guessed), both now load-bearing:

1. **The forked file must be ESM, and cannot be re-bundled by the extension's own (CJS)
   esbuild.** `dependency-cruiser` — a transitive import of `analyze()` — has real top-level
   `await` in some of its own source files. `require()`-ing an ESM graph containing
   top-level await throws `ERR_REQUIRE_ASYNC_MODULE` (confirmed directly:
   `node -e "require('./core/dist/index.js')"` fails this exact way), and esbuild refuses to
   lower top-level await into a CJS *output* at all. Since the worker always runs as its own
   standalone forked process — never `require()`-d by anything — there's no reason it needs
   to match the extension host bundle's CJS format. `extension/esbuild.config.ts` copies
   `core/dist/ipc-worker.js` (already built by `core/tsup.config.ts`) into
   `extension/dist/ipc-worker.mjs` verbatim, rather than re-bundling `core/src/ipc-worker.ts`
   from source a second time — reusing an artifact `core/test/ipc-worker.test.ts` already
   verifies directly is simpler than getting two different bundlers to agree on the same
   file, and a first attempt at re-bundling it with esbuild hit a second, unrelated
   esbuild-specific resolution failure (a deep import inside one of dependency-cruiser's
   optional integrations) that tsup's bundler already tolerates correctly.
2. **`core/tsup.config.ts` needed `splitting: false`.** tsup's default multi-entry behavior
   shares code across entries that import overlapping modules via a separate chunk file —
   every one of core's entries touches `analyze.ts`'s graph, so `ipc-worker.js` depended on a
   sibling chunk file that lived only in `core/dist/`. Copying `ipc-worker.js` out of that
   directory in isolation (point 1, above) silently broke: the copied file still `import`-ed
   a chunk that never made the trip, failing at `fork()` time with `ERR_MODULE_NOT_FOUND`,
   not at build time. `splitting: false` makes every core dist entry fully self-contained,
   which is what makes copying any single one of them in isolation safe.

Neither finding changes the decision itself (`fork()`, one-shot, structured IPC) — both are
implementation details of *how the forked file gets built and where it lives on disk*, now
documented so a future rebuild of this wiring doesn't have to rediscover them the hard way.
See `docs/architecture/PROCESS-BOUNDARY.md`'s "Where the forked file physically lives"
section for the full mechanism.
