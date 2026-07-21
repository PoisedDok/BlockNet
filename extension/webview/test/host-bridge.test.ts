import { beforeAll, describe, expect, it, vi } from 'vitest';
import { onHostMessage, postToHost } from '../src/host-bridge.js';

describe('postToHost with no real VS Code host available', () => {
  // Placed first in the file, before any other block's beforeAll installs a mock
  // acquireVsCodeApi — explicitly deletes it regardless, so this doesn't depend on execution
  // order. Reproduces a real bug: App.tsx's `?sample=1`/`?stress=1` dev/QA fixture modes
  // render the same BlockCanvas tree (including camera-store.ts's drag-persist effect) without
  // ever calling acquireVsCodeApi() first, since no real webview host exists in that path —
  // confirmed via a real Playwright drag against the dev server throwing "acquireVsCodeApi is
  // not defined" ~300ms after every drag before this fix.
  it('does not throw, even after a message is posted', () => {
    delete (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
    expect(() => postToHost({ type: 'layout/persist', positions: { a: { x: 1, y: 2 } } })).not.toThrow();
  });
});

describe('postToHost', () => {
  // acquireVsCodeApi() is memoized inside host-bridge.ts (it may only be called once per real
  // VS Code webview session), so the mock is installed once for this whole describe block,
  // not reset per-test — matching that real constraint rather than fighting it.
  let postMessage: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    postMessage = vi.fn();
    globalThis.acquireVsCodeApi = vi.fn(() => ({ postMessage }));
  });

  it('forwards the message to the acquired VS Code API', () => {
    postToHost({ type: 'webview/ready', generation: 'gen-1' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'webview/ready', generation: 'gen-1' });
  });

  it('only acquires the underlying API once, even across multiple postToHost calls', () => {
    postToHost({ type: 'webview/ready', generation: 'gen-1' });
    expect(globalThis.acquireVsCodeApi).toHaveBeenCalledTimes(1);
  });
});

describe('onHostMessage', () => {
  it('invokes the handler with the message payload on a window message event', () => {
    const handler = vi.fn();
    const unsubscribe = onHostMessage(handler);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'risks/update', risks: [] } }));
    expect(handler).toHaveBeenCalledWith({ type: 'risks/update', risks: [] });
    unsubscribe();
  });

  it('stops invoking the handler after unsubscribe', () => {
    const handler = vi.fn();
    const unsubscribe = onHostMessage(handler);
    unsubscribe();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'risks/update', risks: [] } }));
    expect(handler).not.toHaveBeenCalled();
  });
});
