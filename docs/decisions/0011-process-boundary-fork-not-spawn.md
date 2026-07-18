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
