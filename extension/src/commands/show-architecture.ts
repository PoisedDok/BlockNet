import * as vscode from 'vscode';
import type { AnalysisOutcome, AnalysisRunner } from '../analysis-runner.js';
import { resolveCacheDir } from '../cache-bridge.js';
import { ArchitecturePanel } from '../panel.js';
import type { WatcherTrigger } from '../watcher.js';
import { FileWatcher } from '../watcher.js';

type TriggerOptions = { rootDir: string; cacheDir: string } & WatcherTrigger;

/** Forks one analysis run, streams its progress to the panel, and — only if this run is
 * still the latest one issued (docs/architecture/FLOWS.md §2a: a superseded run's result is
 * discarded silently, never forwarded) — pushes graph/macro + risks/update. */
function triggerAnalysis(runner: AnalysisRunner, panel: ArchitecturePanel, options: TriggerOptions): void {
  const { generation, result } = runner.run({
    ...options,
    onProgress: (p) => panel.post({ type: 'analysis/progress', ...p }),
  });

  result
    .then((outcome: AnalysisOutcome) => {
      if (!runner.isLatest(generation)) return;
      if (outcome.kind === 'success') {
        panel.post({ type: 'graph/macro', nodes: outcome.graph.blocks, edges: outcome.graph.edges });
        panel.post({ type: 'risks/update', risks: outcome.graph.risks });
      } else {
        // outcome.message may be a full stack trace (ipc-worker.ts captures err.stack for
        // debugging) — only its first line belongs in a transient toast; the full message
        // still reaches the console for anyone actually debugging the failure.
        console.error(outcome.message);
        void vscode.window.showErrorMessage(`BlockNet analysis failed: ${outcome.message.split('\n')[0]}`);
      }
    })
    .catch((err: unknown) => {
      if (!runner.isLatest(generation)) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(err);
      void vscode.window.showErrorMessage(`BlockNet analysis failed: ${message}`);
    });
}

/** `blocknet.showArchitecture` — creates/reveals the panel (docs/architecture/FLOWS.md's
 * "cold analyze" and "incremental re-analyze" flows). No workspace or a multi-root workspace
 * are named, visible unsupported states (ENGINEERING-CONSTRAINTS.md) rendered in the panel
 * itself, not a popup — v1 analyzes exactly one workspace root. */
export function registerShowArchitectureCommand(context: vscode.ExtensionContext, runner: AnalysisRunner): vscode.Disposable {
  return vscode.commands.registerCommand('blocknet.showArchitecture', () => {
    const folders = vscode.workspace.workspaceFolders;

    if (folders === undefined || folders.length === 0) {
      ArchitecturePanel.createOrReveal('no-workspace');
      return;
    }
    if (folders.length > 1) {
      ArchitecturePanel.createOrReveal('multi-root');
      return;
    }

    const workspaceFolder = folders[0];
    if (workspaceFolder === undefined) {
      // Unreachable given the length checks above; satisfies noUncheckedIndexedAccess.
      return;
    }
    const rootDir = workspaceFolder.uri.fsPath;
    const cacheDir = resolveCacheDir(context);
    const panel = ArchitecturePanel.createOrReveal('ready');

    triggerAnalysis(runner, panel, { rootDir, cacheDir });

    const watcher = new FileWatcher(workspaceFolder, (trigger) => {
      triggerAnalysis(runner, panel, { rootDir, cacheDir, ...trigger });
    });
    context.subscriptions.push(watcher);
  });
}
