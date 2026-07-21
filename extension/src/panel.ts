import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { HostMessage } from './shared/protocol.js';
import { buildReadyHtml } from './webview-html.js';

// WebviewPanel lifecycle: creation/reveal (singleton — ENGINEERING-CONSTRAINTS.md's "one
// webview, disciplined"), strict CSP, disposal. The 'ready' state serves the real built
// React Flow app (extension/webview/dist/, docs/decisions/0007) via buildReadyHtml()
// (webview-html.ts) — Task 7. Task 6 shipped a placeholder body proving the postMessage
// wiring end to end; that placeholder is gone, not layered underneath this.
//
// `PanelState` covers the no-workspace / multi-root-workspace degrade states
// (ENGINEERING-CONSTRAINTS.md: "never an error toast") by choosing which static body the
// panel renders at creation time, rather than a vscode.window.show*Message popup. The real
// EmptyState.tsx component (Task 8) will own this properly, driven by protocol messages —
// these two inline bodies are a deliberate, honest stand-in until then, same as Task 6 left
// them.
export type PanelState = 'no-workspace' | 'multi-root' | 'ready';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function degradedHtml(webview: vscode.Webview, message: string): string {
  const csp = [`default-src 'none'`, `style-src ${webview.cspSource} 'unsafe-inline'`].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>BlockNet</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 1rem; }
</style>
</head>
<body>
<h2>BlockNet</h2>
<p>${message}</p>
</body>
</html>`;
}

/** Reads and prepares the real webview bundle's HTML. Falls back to a friendly in-panel
 * message (never a crash or a blank panel — ENGINEERING-CONSTRAINTS.md) if the webview
 * wasn't built, which esbuild.config.ts already checks for at extension-build time; this
 * runtime fallback exists for the same reason AnalysisRunner takes workerPath as a
 * parameter — a build-time check doesn't help someone who edits src and reloads without
 * rebuilding. */
function readyHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distUri = vscode.Uri.joinPath(extensionUri, 'webview', 'dist');
  let rawHtml: string;
  try {
    rawHtml = readFileSync(vscode.Uri.joinPath(distUri, 'index.html').fsPath, 'utf8');
  } catch {
    return degradedHtml(webview, 'The webview bundle is missing — run `npm run build --workspace=extension/webview` and reload.');
  }
  const baseHref = `${webview.asWebviewUri(distUri).toString()}/`;
  return buildReadyHtml({ rawHtml, baseHref, cspSource: webview.cspSource, nonce: nonce() });
}

function webviewOptions(state: PanelState, extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
  return {
    enableScripts: state === 'ready',
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview', 'dist')],
  };
}

function renderHtml(webview: vscode.Webview, state: PanelState, extensionUri: vscode.Uri): string {
  if (state === 'no-workspace') return degradedHtml(webview, 'Open a folder to see its architecture.');
  if (state === 'multi-root') return degradedHtml(webview, 'BlockNet does not yet support multi-root workspaces — open a single folder.');
  return readyHtml(webview, extensionUri);
}

export class ArchitecturePanel {
  static #current: ArchitecturePanel | undefined;

  #panel: vscode.WebviewPanel;
  #disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, state: PanelState, extensionUri: vscode.Uri) {
    this.#panel = panel;
    this.#panel.webview.html = renderHtml(this.#panel.webview, state, extensionUri);
    this.#panel.onDidDispose(() => this.dispose(), undefined, this.#disposables);
  }

  static createOrReveal(state: PanelState, extensionUri: vscode.Uri): ArchitecturePanel {
    if (ArchitecturePanel.#current !== undefined) {
      const panel = ArchitecturePanel.#current.#panel;
      // webview.options (unlike .html) isn't reset by reassigning .html — found by two-pass
      // review: a panel first created 'no-workspace' (enableScripts: false) that later
      // transitions to 'ready' without ever being disposed would render the real bundle's
      // markup but never run its <script>, a silent blank canvas. Reassigning .options on
      // every reveal, not just at construction, keeps it in sync with the state actually
      // being rendered.
      panel.webview.options = webviewOptions(state, extensionUri);
      panel.webview.html = renderHtml(panel.webview, state, extensionUri);
      panel.reveal();
      return ArchitecturePanel.#current;
    }
    const panel = vscode.window.createWebviewPanel('blocknet.architecture', 'BlockNet: Architecture', vscode.ViewColumn.Active, webviewOptions(state, extensionUri));
    const instance = new ArchitecturePanel(panel, state, extensionUri);
    ArchitecturePanel.#current = instance;
    return instance;
  }

  post(message: HostMessage): void {
    this.#panel.webview.postMessage(message);
  }

  dispose(): void {
    ArchitecturePanel.#current = undefined;
    for (const d of this.#disposables.splice(0)) d.dispose();
    this.#panel.dispose();
  }
}
