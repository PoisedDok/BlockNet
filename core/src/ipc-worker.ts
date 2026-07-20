import { analyze } from './analyze.js';
import type { AnalyzeOptions, GraphResult, Progress } from './types.js';

// Forked entrypoint for extension/src/analysis-runner.ts (docs/architecture/PROCESS-BOUNDARY.md,
// decisions/0011). Thin adapter over analyze() — contains no analysis logic itself, same
// "no logic in the entrypoint" contract cli.ts already keeps. One-shot: handles exactly one
// request message, runs one analyze() call, sends progress messages then a result or error
// message, and then waits — it does not self-exit. Killing the process is analysis-runner.ts's
// job (ADR-0011's "fork → one message in → one message out → kill" lifecycle), not this file's;
// an uncaught exception here must never surface as a bare non-zero exit with no explanation,
// so every analyze() rejection is caught and reported as a structured 'error' message instead.

export type WorkerRequest = Pick<AnalyzeOptions, 'rootDir' | 'cacheDir' | 'changedFiles'>;

export type WorkerMessage =
  | ({ type: 'progress' } & Progress)
  | { type: 'result'; graph: GraphResult }
  | { type: 'error'; message: string };

function send(message: WorkerMessage) {
  process.send?.(message);
}

process.once('message', (request: WorkerRequest) => {
  const { rootDir, cacheDir, changedFiles } = request;
  analyze({
    rootDir,
    ...(cacheDir !== undefined && { cacheDir }),
    ...(changedFiles !== undefined && { changedFiles }),
    onProgress: (p) => send({ type: 'progress', ...p }),
  })
    .then((graph) => send({ type: 'result', graph }))
    .catch((err: unknown) => {
      send({ type: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    });
});
