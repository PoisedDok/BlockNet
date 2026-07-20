import { resolve } from 'node:path';
import * as vscode from 'vscode';
import { AnalysisRunner } from './analysis-runner.js';
import { registerShowArchitectureCommand } from './commands/show-architecture.js';

// Lazy activation (package.json's activationEvents: workspaceContains:**/tsconfig.json; VS
// Code auto-generates the onCommand:blocknet.showArchitecture event from contributes.commands
// — see docs/architecture/ENGINEERING-CONSTRAINTS.md). No analysis work happens here: this
// only registers the command and an AnalysisRunner, both of which stay idle until the command
// fires (docs/architecture/FLOWS.md).
export function activate(context: vscode.ExtensionContext): void {
  // __dirname here is dist/ (this file is bundled into dist/extension.js by esbuild) — the
  // forked worker (esbuild.config.ts copies it verbatim from @blocknet/core's own build) lives
  // right alongside it, never resolved via node_modules (docs/architecture/PROCESS-BOUNDARY.md).
  const workerPath = resolve(__dirname, 'ipc-worker.mjs');
  const runner = new AnalysisRunner(workerPath);
  context.subscriptions.push({ dispose: () => runner.dispose() });
  context.subscriptions.push(registerShowArchitectureCommand(context, runner));
}

export function deactivate(): void {
  // Nothing beyond what context.subscriptions already tears down (AnalysisRunner.dispose()
  // kills any in-flight forked worker; the FileWatcher registered per-command-invocation
  // disposes its vscode.FileSystemWatcher) — see activate() and commands/show-architecture.ts.
}
