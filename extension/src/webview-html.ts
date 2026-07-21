// Pure HTML transformation for the built webview bundle — no vscode import, so it's
// unit-testable outside a real extension host (the same split panel.ts's own header comment
// and docs/architecture/LAYERS.md already apply to analysis-runner.ts/cache-bridge.ts/
// change-buffer.ts). panel.ts supplies the vscode-derived strings (webview.cspSource,
// webview.asWebviewUri()) as plain parameters rather than passing the vscode.Webview object
// itself.

export type ReadyHtmlParams = {
  /** Raw contents of extension/webview/dist/index.html, built by vite with base: './' so
   * every asset reference (script src, link href, and the CSS's own @font-face url()s) is
   * relative — resolvable once a <base> tag anchors them at the real webview URI. */
  rawHtml: string;
  /** webview.asWebviewUri(...) pointed at extension/webview/dist/, with a trailing slash. */
  baseHref: string;
  /** webview.cspSource — the vscode-webview:// origin this specific panel's resources load
   * from, scoping the CSP to exactly this panel rather than any webview. */
  cspSource: string;
  nonce: string;
  /** A fresh id panel.ts mints on every html (re)assignment. Echoed back by the webview in its
   * webview/ready message so whenReady() can tell this navigation's ready apart from a stale
   * one posted by a script instance a later createOrReveal() call already superseded — see
   * panel.ts's #currentGeneration. */
  generation: string;
};

/** Injects a `<base>` tag (so the build's relative asset URLs resolve against the real
 * webview URI), a strict CSP meta tag, a generation-id meta tag, and a nonce on the built
 * `<script>` tag. Every other byte of the built HTML passes through untouched — this only
 * prepares it for extension-host serving, it doesn't restructure the build vite already
 * produced. */
export function buildReadyHtml({ rawHtml, baseHref, cspSource, nonce, generation }: ReadyHtmlParams): string {
  const csp = [`default-src 'none'`, `style-src ${cspSource}`, `font-src ${cspSource}`, `script-src 'nonce-${nonce}'`].join('; ');

  const withBase = rawHtml.replace(
    '<head>',
    `<head>\n    <base href="${baseHref}">\n    <meta http-equiv="Content-Security-Policy" content="${csp}">\n    <meta name="blocknet-generation" content="${generation}">`,
  );

  // /g: today's build emits exactly one <script> tag, but nonce-ing only the first would
  // silently CSP-block any future one (e.g. vite code-splitting into a vendor chunk) — fails
  // closed (blank canvas), not a security hole, but worth not leaving as a landmine for a
  // single-chunk assumption nothing else states explicitly.
  return withBase.replace(/<script type="module"/g, `<script type="module" nonce="${nonce}"`);
}
