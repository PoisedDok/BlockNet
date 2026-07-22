import { fork, type ChildProcess } from 'node:child_process';
import type { GraphResult, LayerGraphResult, Progress, WorkerMessage, WorkerRequest } from '@blocknet/core';

export type AnalysisOutcome = { kind: 'success'; graph: GraphResult } | { kind: 'error'; message: string };

export type RunOptions = {
  rootDir: string;
  cacheDir?: string;
  changedFiles?: string[];
  onProgress?: (p: Progress) => void;
};

// v2.0.1 unified layer model (docs/planning/ROADMAP-V2.md) — cacheDir is required (unlike
// macro's optional one): analyzeLayer() has nothing to compute from without a prior macro
// run's cache, so there's no meaningful "uncached layer run" the way there's a meaningful
// "uncached macro run" for CLI/CI callers.
export type LayerRunOptions = { rootDir: string; cacheDir: string; layerPath: string };

export type LayerOutcome = { kind: 'success'; layer: LayerGraphResult } | { kind: 'error'; message: string };

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
  // Independent generation counter/namespace from macro's #latestGeneration above — layer
  // navigation (drilling through folders, floor-picker clicks) is triggered far more often
  // than a macro re-analysis (docs/planning/ROADMAP-V2.md's v2.0.1 "process-boundary judgment
  // call" note), and must never be superseded by an unrelated macro re-analysis a file save
  // happened to trigger concurrently, and vice versa.
  #latestLayerGeneration = 0;
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
      mode: 'macro',
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
        } else if (message.type === 'error') {
          settle({ kind: 'error', message: message.message });
        } else {
          // 'layer-result' is unreachable on this stream — this fork only ever receives the
          // 'macro' request built above, and ipc-worker.ts only ever sends 'layer-result' in
          // response to a 'layer' request. Handled anyway (not a `never`-typed fallthrough)
          // because WorkerMessage is shared across both streams, so the type system can't
          // encode "this fork's request mode" on its own — the same defensive-exhaustiveness
          // posture App.tsx's HostMessage switch already established.
          settle({ kind: 'error', message: `unexpected message type "${message.type}" on the macro analysis stream` });
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

  /** Forks a fresh worker for one layer's item/edge/arrow query (docs/planning/ROADMAP-V2.md's
   * v2.0.1 unified layer model). Same one-shot fork lifecycle as run() above, gated by its own
   * independent generation counter (#latestLayerGeneration) — see that field's own comment for
   * why it can't share run()'s counter. Does not queue behind an in-flight layer request
   * either, matching run()'s own "a second call gets a second, independent worker" behavior —
   * navigating to a different layer while a previous request is still in flight is a normal,
   * frequent user action here, not a rare race to special-case. */
  runLayer(options: LayerRunOptions): { generation: number; result: Promise<LayerOutcome> } {
    const generation = ++this.#latestLayerGeneration;
    const child = fork(this.workerPath, [], { stdio: 'pipe' });
    this.#children.add(child);

    const request: WorkerRequest = { mode: 'layer', rootDir: options.rootDir, cacheDir: options.cacheDir, layerPath: options.layerPath };

    const result = new Promise<LayerOutcome>((settle) => {
      child.on('message', (message: WorkerMessage) => {
        if (message.type === 'layer-result') {
          settle({ kind: 'success', layer: message.layer });
        } else if (message.type === 'error') {
          settle({ kind: 'error', message: message.message });
        }
        // 'progress' is never sent for a layer request (ipc-worker.ts's runLayer doesn't call
        // onProgress) — no branch needed here, unlike run()'s handler above.
      });
      child.on('error', (err) => {
        settle({ kind: 'error', message: err.message });
      });
      child.on('exit', (code, signal) => {
        settle({ kind: 'error', message: `worker exited before finishing (code ${code}, signal ${signal})` });
      });
      child.send(request);
    }).finally(() => {
      this.#children.delete(child);
      child.kill();
    });

    return { generation, result };
  }

  /** True if `generation` is still the most recently started layer run — the layer-stream
   * counterpart to isLatest() above, checked against #latestLayerGeneration. */
  isLatestLayer(generation: number): boolean {
    return generation === this.#latestLayerGeneration;
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
