import { relative, sep } from 'node:path';
import * as vscode from 'vscode';
import { ChangeBuffer, type ChangeKind, type WatcherTrigger } from './change-buffer.js';

export type { WatcherTrigger } from './change-buffer.js';

function toPosixRelative(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath).split(sep).join('/');
}

/** Wires a real `vscode.FileSystemWatcher` (workspace-scoped, `**\/*`) into a ChangeBuffer
 * (change-buffer.ts), debouncing ~500ms (docs/architecture/FLOWS.md §2a) before firing
 * onTrigger with the flushed buffer. One instance per workspace folder; disposed alongside
 * the extension. */
export class FileWatcher implements vscode.Disposable {
  #fsWatcher: vscode.FileSystemWatcher;
  #buffer = new ChangeBuffer();
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(workspaceFolder: vscode.WorkspaceFolder, onTrigger: (trigger: WatcherTrigger) => void, debounceMs = 500) {
    const rootDir = workspaceFolder.uri.fsPath;
    const record = (kind: ChangeKind) => (uri: vscode.Uri) => {
      this.#buffer.record(kind, toPosixRelative(rootDir, uri.fsPath));
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => onTrigger(this.#buffer.flush()), debounceMs);
    };

    this.#fsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, '**/*'));
    this.#fsWatcher.onDidCreate(record('create'));
    this.#fsWatcher.onDidChange(record('change'));
    this.#fsWatcher.onDidDelete(record('delete'));
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#fsWatcher.dispose();
  }
}
