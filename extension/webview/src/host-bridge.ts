import type { HostMessage, WebviewMessage } from '../../src/shared/protocol.js';

// Imported by relative path across the extension/ directory boundary, not a workspace
// package — see docs/architecture/PROTOCOL.md's "why one file, not two." Both esbuild
// (extension host) and vite (webview) resolve this the same way, confirmed directly by
// building both.

type VsCodeApi = { postMessage(message: WebviewMessage): void };

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}

const noopApi: VsCodeApi = { postMessage: () => {} };

let api: VsCodeApi | undefined;

// acquireVsCodeApi() may only be called once per webview session — VS Code throws "An
// instance of the VS Code API has already been acquired" on a second call — so this memoizes
// the one real instance instead of calling it at module load (which would also make every
// test importing this module require the global mocked just to import it, not just to use it).
//
// Falls back to a no-op instead of calling (and crashing on) a nonexistent global when there's
// no real VS Code host — App.tsx's `?sample=1`/`?stress=1` dev/QA fixture modes render the
// exact same BlockCanvas tree as the live path, including camera-store.ts's drag-persist
// effect, so this needs to be safe outside a real webview too, not just inside App.tsx's own
// top-level branch. Confirmed as a real bug, not theoretical: dragging a node under the
// fixture bypass threw an uncaught "acquireVsCodeApi is not defined" ~300ms after every drag
// (camera-store.ts's debounce), reproduced via a real Playwright mouse-drag against the dev
// server, not just inferred from reading the code.
function getApi(): VsCodeApi {
  if (typeof acquireVsCodeApi !== 'function') return noopApi;
  api ??= acquireVsCodeApi();
  return api;
}

export function postToHost(message: WebviewMessage): void {
  getApi().postMessage(message);
}

/** Subscribes to HostMessage postMessage events; returns an unsubscribe function. */
export function onHostMessage(handler: (message: HostMessage) => void): () => void {
  const listener = (event: MessageEvent<HostMessage>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
