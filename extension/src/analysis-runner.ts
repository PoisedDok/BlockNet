import { fork, type ChildProcess } from 'node:child_process';
import type { GraphResult, Progress, WorkerMessage, WorkerRequest } from '@blocknet/core';

export type AnalysisOutcome = { kind: 'success'; graph: GraphResult } | { kind: 'error'; message: string };

export type RunOptions = {
  rootDir: string;
  cacheDir?: string;
  changedFiles?: string[];
  onProgress?: (p: Progress) => void;
};

/** Owns the forked child-process lifecycle for one-shot analyze() runs (decisions/0011): fork
 * → one request in → progress messages + one result/error out → caller kills the child.
 * Tracks a monotonically increasing generation id per run and gates BOTH progress messages
 * and the terminal outcome against it — a run superseded by a newer one is fully invisible
 * to its caller from the moment it's superseded, not just at its final result
 * (docs/architecture/FLOWS.md §2a: "the webview never regresses to older data because an
 * older analysis happened to finish last" — this must hold for in-flight progress too, not
 * only the completion message, or a stale "Analyzing… N/4" can outlive the newer run's own
 * "complete" state with nothing left to correct it).
 * Deliberately has zero `vscode` import: the fork lifecycle and generation bookkeeping here is
 * pure Node and unit-testable headlessly; only cache-bridge.ts and watcher.ts in this layer
 * actually need the VS Code API. Takes `workerPath` as a constructor parameter rather than
 * computing it from its own `__dirname` — this class only resolves to the right file when
 * bundled into extension/dist/ (the caller — extension.ts, which lives in that same bundle —
 * is what actually knows its own `__dirname` at runtime; passing it in also means this class
 * can be unit-tested against the real forked worker without needing to *be* bundled first). */
export class AnalysisRunner {
  #latestGeneration = 0;
  #children = new Set<ChildProcess>();

  constructor(private readonly workerPath: string) {}

  /** Forks a fresh worker, assigns it the next generation id, and resolves with that run's
   * outcome. Does not queue behind an in-flight run — a caller invoking run() again before a
   * previous call's promise settles gets a second, independent forked worker (FLOWS.md §2a:
   * "does not queue it behind the first"). The caller decides whether the resolved outcome is
   * still worth forwarding by checking isLatest(generation) once it resolves. */
  run(options: RunOptions): { generation: number; result: Promise<AnalysisOutcome> } {
    const generation = ++this.#latestGeneration;
    const child = fork(this.workerPath, [], { stdio: 'pipe' });
    this.#children.add(child);

    const request: WorkerRequest = {
      rootDir: options.rootDir,
      ...(options.cacheDir !== undefined && { cacheDir: options.cacheDir }),
      ...(options.changedFiles !== undefined && { changedFiles: options.changedFiles }),
    };

    const result = new Promise<AnalysisOutcome>((settle) => {
      child.on('message', (message: WorkerMessage) => {
        if (message.type === 'progress') {
          // Gated the same way the final outcome is: a run superseded by a newer one before
          // it finishes must never surface *any* observable effect, not just its terminal
          // result — otherwise a stale "Analyzing… N/4" progress message can arrive after the
          // latest run's own completion message already rendered, and nothing ever corrects
          // it again (found by this project's own architectural-soundness review, Task 6:
          // confirmed via two real overlapping runs that the older one's late progress event
          // silently overwrote the newer one's "complete" status with no way back).
          if (this.isLatest(generation)) options.onProgress?.(message);
        } else if (message.type === 'result') {
          settle({ kind: 'success', graph: message.graph });
        } else {
          settle({ kind: 'error', message: message.message });
        }
      });
      child.on('error', (err) => {
        settle({ kind: 'error', message: err.message });
      });
      child.on('exit', (code, signal) => {
        // Only reachable if the worker crashed or was killed before ever sending a
        // result/error message (the normal path always sends one, then this class kills
        // the process in .finally() below — by which point the promise has already
        // settled, so this branch is a no-op then, not a race). Reporting it here means a
        // crashed worker surfaces as a structured error, never a promise that hangs forever.
        settle({ kind: 'error', message: `worker exited before finishing (code ${code}, signal ${signal})` });
      });
      child.send(request);
    }).finally(() => {
      this.#children.delete(child);
      child.kill();
    });

    return { generation, result };
  }

  /** True if `generation` is still the most recently started run — the check a caller uses,
   * once a run's promise resolves, to decide whether to forward its result to the webview or
   * silently discard it as superseded (FLOWS.md §2a). */
  isLatest(generation: number): boolean {
    return generation === this.#latestGeneration;
  }

  /** Kills every still-running forked worker. Call on extension deactivate() / panel disposal
   * so no orphaned child process outlives the extension host. */
  dispose(): void {
    for (const child of this.#children) {
      child.kill();
    }
    this.#children.clear();
  }
}
