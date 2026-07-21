import { describe, expect, it } from 'vitest';
import { buildReadyHtml } from '../src/webview-html.js';

const rawHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>BlockNet</title>
    <script type="module" crossorigin src="./assets/index-ABC123.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-XYZ789.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const params = { rawHtml, baseHref: 'https://webview-uri.example/webview/dist/', cspSource: 'https://webview-uri.example', nonce: 'test-nonce-123', generation: 'gen-abc' };

describe('buildReadyHtml', () => {
  it('injects a <base> tag pointing at the webview dist URI', () => {
    const html = buildReadyHtml(params);
    expect(html).toContain('<base href="https://webview-uri.example/webview/dist/">');
  });

  it('places the <base> tag before any relative-URL element (script/link)', () => {
    const html = buildReadyHtml(params);
    expect(html.indexOf('<base')).toBeLessThan(html.indexOf('<script'));
    expect(html.indexOf('<base')).toBeLessThan(html.indexOf('<link'));
  });

  it('adds the nonce to the built script tag', () => {
    const html = buildReadyHtml(params);
    expect(html).toContain(`<script type="module" nonce="test-nonce-123" crossorigin src="./assets/index-ABC123.js"></script>`);
  });

  it('injects a CSP meta tag scoped to the given cspSource and nonce', () => {
    const html = buildReadyHtml(params);
    expect(html).toContain(`script-src 'nonce-test-nonce-123'`);
    expect(html).toContain(`style-src https://webview-uri.example`);
    expect(html).toContain(`font-src https://webview-uri.example`);
    expect(html).toContain(`default-src 'none'`);
  });

  it('preserves the rest of the document (root div) untouched', () => {
    const html = buildReadyHtml(params);
    expect(html).toContain('<div id="root"></div>');
  });

  it('injects a meta tag carrying the generation id, for the ready-handshake race fix', () => {
    // panel.ts's whenReady() must be able to tell a stale 'webview/ready' (posted by a script
    // instance a later createOrReveal() call already superseded) apart from the one it's
    // actually waiting for — see panel.ts's own comment on #currentGeneration. The webview
    // reads this meta tag and echoes its value back in the webview/ready message.
    const html = buildReadyHtml(params);
    expect(html).toContain('<meta name="blocknet-generation" content="gen-abc">');
  });

  it('adds the nonce to every <script type="module"> tag, not just the first', () => {
    // Today's build emits exactly one script tag, but nothing prevents a future build
    // (vite code-splitting a vendor chunk, say) from emitting a second — an unmoved regex
    // would silently CSP-block it (fails closed, not open, but still a real regression with
    // no coverage until this test).
    const multiScriptHtml = rawHtml.replace(
      '<script type="module" crossorigin src="./assets/index-ABC123.js"></script>',
      '<script type="module" crossorigin src="./assets/index-ABC123.js"></script>\n    <script type="module" crossorigin src="./assets/vendor-DEF456.js"></script>',
    );
    const html = buildReadyHtml({ ...params, rawHtml: multiScriptHtml });
    const matches = html.match(/<script type="module" nonce="test-nonce-123"/g);
    expect(matches).toHaveLength(2);
  });
});
