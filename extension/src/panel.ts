import * as vscode from 'vscode';
import type { HostMessage } from './shared/protocol.js';

// WebviewPanel lifecycle: creation/reveal (singleton — ENGINEERING-CONSTRAINTS.md's "one
// webview, disciplined"), strict CSP, disposal. Task 6 ships a minimal placeholder body
// (progress text + a raw JSON dump of the received graph) — the real React Flow macro graph
// (BlockCanvas, design tokens, card layout, etc.) is Task 7's job entirely
// (docs/planning/TASKS-V1.md); this file's job is proving the postMessage wiring end to end,
// not rendering the graph.
//
// `PanelState` covers the no-workspace / multi-root-workspace degrade states
// (ENGINEERING-CONSTRAINTS.md: "never an error toast") by choosing which static body the
// panel renders at creation time, rather than a vscode.window.show*Message popup. The real
// EmptyState.tsx component (Task 7/8) will own this properly, driven by protocol messages —
// this is a deliberately temporary, honest stand-in for Task 6's scope only.
export type PanelState = 'no-workspace' | 'multi-root' | 'ready';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function renderHtml(webview: vscode.Webview, state: PanelState): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce()}'`,
  ].join('; ');

  const body =
    state === 'no-workspace'
      ? '<p>Open a folder to see its architecture.</p>'
      : state === 'multi-root'
        ? '<p>BlockNet does not yet support multi-root workspaces — open a single folder.</p>'
        : '<div id="status">Waiting for analysis…</div><pre id="output"></pre>';

  const script =
    state === 'ready'
      ? `<script nonce="${nonce()}">
      const status = document.getElementById('status');
      const output = document.getElementById('output');
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'analysis/progress') {
          status.textContent = 'Analyzing… ' + message.phase + ' (' + message.done + '/' + message.total + ')';
        } else if (message.type === 'graph/macro') {
          status.textContent = 'Analysis complete: ' + message.nodes.length + ' block(s), ' + message.edges.length + ' edge(s).';
          output.textContent = JSON.stringify(message, null, 2);
        } else if (message.type === 'risks/update') {
          output.textContent += '\\n\\nRisks:\\n' + JSON.stringify(message.risks, null, 2);
        }
      });
    </script>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>BlockNet</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 1rem; }
  pre { white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<h2>BlockNet</h2>
${body}
${script}
</body>
</html>`;
}

export class ArchitecturePanel {
  static #current: ArchitecturePanel | undefined;

  #panel: vscode.WebviewPanel;
  #disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, state: PanelState) {
    this.#panel = panel;
    this.#panel.webview.html = renderHtml(this.#panel.webview, state);
    this.#panel.onDidDispose(() => this.dispose(), undefined, this.#disposables);
  }

  static createOrReveal(state: PanelState): ArchitecturePanel {
    if (ArchitecturePanel.#current !== undefined) {
      ArchitecturePanel.#current.#panel.webview.html = renderHtml(ArchitecturePanel.#current.#panel.webview, state);
      ArchitecturePanel.#current.#panel.reveal();
      return ArchitecturePanel.#current;
    }
    const panel = vscode.window.createWebviewPanel('blocknet.architecture', 'BlockNet: Architecture', vscode.ViewColumn.Active, {
      enableScripts: state === 'ready',
      retainContextWhenHidden: true,
    });
    const instance = new ArchitecturePanel(panel, state);
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
