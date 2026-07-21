import { analyzeMicroBlock } from './analyze-micro.js';
import { analyze } from './analyze.js';
import type { AnalyzeOptions, GraphResult, MicroGraphResult, Progress } from './types.js';

// Forked entrypoint for extension/src/analysis-runner.ts (docs/architecture/PROCESS-BOUNDARY.md,
// decisions/0011). Thin adapter over analyze()/analyzeMicroBlock() — contains no analysis logic
// itself, same "no logic in the entrypoint" contract cli.ts already keeps. One-shot: handles
// exactly one request message, runs exactly one of the two calls below (never both — `mode`
// picks which, docs/planning/ROADMAP-V2.md's v2.0 micro view), sends progress messages (macro
// only) then a result/micro-result/error message, and then waits — it does not self-exit.
// Killing the process is analysis-runner.ts's job (ADR-0011's "fork → one message in → one
// message out → kill" lifecycle), not this file's; an uncaught exception here must never
// surface as a bare non-zero exit with no explanation, so every rejection is caught and
// reported as a structured 'error' message instead.

export type MacroWorkerRequest = { mode: 'macro' } & Pick<AnalyzeOptions, 'rootDir' | 'cacheDir' | 'changedFiles'>;
export type MicroWorkerRequest = { mode: 'micro'; rootDir: string; cacheDir: string; blockId: string };
export type WorkerRequest = MacroWorkerRequest | MicroWorkerRequest;

export type WorkerMessage =
  | ({ type: 'progress' } & Progress)
  | { type: 'result'; graph: GraphResult }
  | { type: 'micro-result'; micro: MicroGraphResult }
  | { type: 'error'; message: string };

function send(message: WorkerMessage) {
  process.send?.(message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

function runMacro(request: MacroWorkerRequest) {
  const { rootDir, cacheDir, changedFiles } = request;
  analyze({
    rootDir,
    ...(cacheDir !== undefined && { cacheDir }),
    ...(changedFiles !== undefined && { changedFiles }),
    onProgress: (p) => send({ type: 'progress', ...p }),
  })
    .then((graph) => send({ type: 'result', graph }))
    .catch((err: unknown) => send({ type: 'error', message: errorMessage(err) }));
}

function runMicro(request: MicroWorkerRequest) {
  analyzeMicroBlock(request)
    .then((micro) => {
      if (micro) {
        send({ type: 'micro-result', micro });
      } else {
        // No cache yet, or blockId no longer in the cached snapshot (analyze-micro.ts's own
        // degrade rule) — surfaced as a structured error like any other failure, not a hang;
        // the extension host turns this into a friendly inline notice, never a crash
        // (commands/show-architecture.ts).
        send({ type: 'error', message: `No cached analysis found for block "${request.blockId}" — reopen BlockNet: Show Architecture to refresh.` });
      }
    })
    .catch((err: unknown) => send({ type: 'error', message: errorMessage(err) }));
}

process.once('message', (request: WorkerRequest) => {
  if (request.mode === 'micro') {
    runMicro(request);
  } else {
    runMacro(request);
  }
});
