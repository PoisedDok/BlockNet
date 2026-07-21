import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { HostMessage, Position, WebviewMessage } from './shared/protocol.js';
import { buildReadyHtml } from './webview-html.js';

// WebviewPanel lifecycle: creation/reveal (singleton — ENGINEERING-CONSTRAINTS.md's "one
// webview, disciplined"), strict CSP, disposal. The 'ready' state serves the real built
// React Flow app (extension/webview/dist/, docs/decisions/0007) via buildReadyHtml()
// (webview-html.ts) — Task 7. Task 6 shipped a placeholder body proving the postMessage
// wiring end to end; that placeholder is gone, not layered underneath this.
//
// `PanelState` covers the no-workspace / multi-root-workspace degrade states
// (ENGINEERING-CONSTRAINTS.md: "never an error toast") by choosing which static body the
// panel renders at creation time, rather than a vscode.window.show*Message popup. These two
// inline HTML bodies (enableScripts: false) are the permanent implementation, not a stand-in
// for a future EmptyState.tsx — Task 8 decided against building one: no script ever runs for
// either state, so there's nothing for a React component to buy here, and enabling scripts
// just to render two lines of static text would widen the security posture for zero benefit.
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
function readyHtml(webview: vscode.Webview, extensionUri: vscode.Uri, generation: string): string {
  const distUri = vscode.Uri.joinPath(extensionUri, 'webview', 'dist');
  let rawHtml: string;
  try {
    rawHtml = readFileSync(vscode.Uri.joinPath(distUri, 'index.html').fsPath, 'utf8');
  } catch {
    return degradedHtml(webview, 'The webview bundle is missing — run `npm run build --workspace=extension/webview` and reload.');
  }
  const baseHref = `${webview.asWebviewUri(distUri).toString()}/`;
  return buildReadyHtml({ rawHtml, baseHref, cspSource: webview.cspSource, nonce: nonce(), generation });
}

function webviewOptions(state: PanelState, extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
  return {
    enableScripts: state === 'ready',
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview', 'dist')],
  };
}

function renderHtml(webview: vscode.Webview, state: PanelState, extensionUri: vscode.Uri, generation: string): string {
  if (state === 'no-workspace') return degradedHtml(webview, 'Open a folder to see its architecture.');
  if (state === 'multi-root') return degradedHtml(webview, 'BlockNet does not yet support multi-root workspaces — open a single folder.');
  return readyHtml(webview, extensionUri, generation);
}

export class ArchitecturePanel {
  static #current: ArchitecturePanel | undefined;

  #panel: vscode.WebviewPanel;
  #disposables: vscode.Disposable[] = [];
  // A fresh id minted on every html (re)assignment — see whenReady()'s comment for the race
  // this closes. undefined for 'no-workspace'/'multi-root' (no script ever runs to echo one
  // back).
  #currentGeneration: string | undefined;

  // onLayoutPersist/onOpenFile are wired once, here, at construction only — the reveal path
  // in createOrReveal below deliberately doesn't re-wire them. Safe to skip: both callbacks
  // are stateless w.r.t. which invocation constructed vs. revealed the panel (each closes over
  // state that outlives the whole extension lifetime — context.workspaceState / rootDir),
  // so registering them a second time on reveal would only produce duplicate listeners firing
  // twice per action — harmless (idempotent for layout/persist; open/file's second
  // showTextDocument call is a no-op focus-follow) but sloppy, and avoidable for free.
  private constructor(
    panel: vscode.WebviewPanel,
    state: PanelState,
    extensionUri: vscode.Uri,
    onLayoutPersist: (positions: Record<string, Position>) => void,
    onOpenFile: (fileId: string, line?: number) => void,
  ) {
    this.#panel = panel;
    this.#currentGeneration = state === 'ready' ? nonce() : undefined;
    this.#panel.webview.html = renderHtml(this.#panel.webview, state, extensionUri, this.#currentGeneration ?? '');
    this.#panel.onDidDispose(() => this.dispose(), undefined, this.#disposables);
    this.#panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        if (message.type === 'layout/persist') onLayoutPersist(message.positions);
        if (message.type === 'open/file') onOpenFile(message.fileId, message.line);
      },
      undefined,
      this.#disposables,
    );
  }

  /** onLayoutPersist/onOpenFile are only actually used the first time a given panel is
   * constructed — see the constructor's own comment for why the reveal path below ignores
   * them safely. */
  static createOrReveal(
    state: PanelState,
    extensionUri: vscode.Uri,
    onLayoutPersist: (positions: Record<string, Position>) => void,
    onOpenFile: (fileId: string, line?: number) => void,
  ): ArchitecturePanel {
    if (ArchitecturePanel.#current !== undefined) {
      const instance = ArchitecturePanel.#current;
      const panel = instance.#panel;
      // webview.options (unlike .html) isn't reset by reassigning .html — found by two-pass
      // review: a panel first created 'no-workspace' (enableScripts: false) that later
      // transitions to 'ready' without ever being disposed would render the real bundle's
      // markup but never run its <script>, a silent blank canvas. Reassigning .options on
      // every reveal, not just at construction, keeps it in sync with the state actually
      // being rendered.
      panel.webview.options = webviewOptions(state, extensionUri);
      instance.#currentGeneration = state === 'ready' ? nonce() : undefined;
      panel.webview.html = renderHtml(panel.webview, state, extensionUri, instance.#currentGeneration ?? '');
      panel.reveal();
      return instance;
    }
    const panel = vscode.window.createWebviewPanel('blocknet.architecture', 'BlockNet: Architecture', vscode.ViewColumn.Active, webviewOptions(state, extensionUri));
    const instance = new ArchitecturePanel(panel, state, extensionUri, onLayoutPersist, onOpenFile);
    ArchitecturePanel.#current = instance;
    return instance;
  }

  post(message: HostMessage): void {
    this.#panel.webview.postMessage(message);
  }

  /** Resolves once the webview's currently-loaded script posts 'webview/ready'. Every
   * createOrReveal('ready', ...) call reassigns webview.html unconditionally (even on the
   * reveal path, even to identical content — a pre-existing behavior this doesn't change),
   * which VS Code always treats as a fresh navigation: the previous script instance is gone
   * and a new one runs main.tsx from scratch. That means there is no "already ready, skip the
   * wait" case to special-case — every call needs a fresh 'webview/ready' before it's safe to
   * post layout/restore or graph/macro, or VS Code silently drops the postMessage (no queue).
   * 'no-workspace'/'multi-root' states never resolve this (enableScripts: false — no script
   * ever runs to post it), so callers must only call whenReady() after a 'ready' reveal.
   *
   * Matches on #currentGeneration, captured at call time — closes a real re-entrancy gap
   * two-pass review found: a rapid double-invocation of the command reassigns html twice in
   * quick succession (two script instances racing to load), and without a generation check, an
   * earlier whenReady() call could resolve on the WRONG (already-superseded) script's ready
   * message. Callers must still re-check isCurrentGeneration() after this resolves — see its
   * own comment for why matching alone isn't sufficient. */
  whenReady(): Promise<void> {
    const expected = this.#currentGeneration;
    return new Promise((resolve) => {
      const subscription = this.#panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message.type === 'webview/ready' && message.generation === expected) {
          subscription.dispose();
          resolve();
        }
      });
    });
  }

  /** True if `generation` (captured from a prior whenReady() call's own generation, read via
   * the caller's own bookkeeping — see commands/show-architecture.ts) still matches the
   * panel's live generation. A caller must check this AFTER whenReady() resolves, not just
   * rely on the match inside whenReady() itself: whenReady() resolving only proves that
   * specific generation's script did become ready at some point — by the time the .then()
   * callback actually runs, a second, later createOrReveal() call may have already reassigned
   * html again (a newer generation), making the first call's webview instance stale even
   * though its own wait was satisfied. Posting into a stale generation is silently dropped by
   * VS Code, so the real fix is skipping the post entirely, not just resolving correctly. */
  isCurrentGeneration(generation: string | undefined): boolean {
    return generation !== undefined && generation === this.#currentGeneration;
  }

  get currentGeneration(): string | undefined {
    return this.#currentGeneration;
  }

  dispose(): void {
    ArchitecturePanel.#current = undefined;
    for (const d of this.#disposables.splice(0)) d.dispose();
    this.#panel.dispose();
  }
}
