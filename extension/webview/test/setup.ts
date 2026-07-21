import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

// jsdom runs no real layout engine, so every element's measured geometry is 0x0 — but React
// Flow's node-measurement pipeline (@xyflow/system's
// updateNodeInternals) reads exactly offsetWidth/offsetHeight/getBoundingClientRect() on the
// real DOM node (confirmed by reading its source, not assumed) to decide a node is
// "measured" before making it visible or routing any edge to it. Left unmocked, every node
// stays permanently `visibility: hidden` and every edge silently renders zero — not a crash,
// so it's easy to mistake for "the component just doesn't render edges." Fixed sizes here are
// fine: our tests assert on data/DOM structure and inline style, never on real pixel geometry.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 236 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 120 });
HTMLElement.prototype.getBoundingClientRect = () =>
  ({ width: 236, height: 120, top: 0, left: 0, bottom: 120, right: 236, x: 0, y: 0, toJSON() {} }) as DOMRect;

// The ResizeObserver callback needs to fire once for two different consumers: per-node
// measurement (reads getBoundingClientRect()/offsetWidth on entry.target — mocked above) and
// the pane/viewport container's own observer (XYPanZoom, which reads entry.contentRect
// directly) — so the stub's entry needs both a real target and a populated contentRect.
class ResizeObserverStub {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element): void {
    const entry = {
      target,
      contentRect: { width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0 },
    } as ResizeObserverEntry;
    this.#callback([entry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom has no DOMMatrixReadOnly (confirmed: `window.DOMMatrixReadOnly is not a constructor`
// thrown from inside @xyflow/system's own viewport-transform math) — a minimal stand-in
// covering only the fields React Flow actually reads from it.
class DOMMatrixReadOnlyStub {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(init?: string | number[]) {
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init as [number, number, number, number, number, number];
    }
  }
}
globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;

// jsdom has no Pointer Capture implementation at all (confirmed: Element.prototype.
// setPointerCapture is undefined, not just a no-op) — RiskEdge.tsx's draggable waypoint handle
// (ROADMAP-V2.md's draggable/bendable edge routing) calls setPointerCapture/
// releasePointerCapture on every real pointerdown/up, which every real browser (including VS
// Code's Electron/Chromium webview host) fully supports. This is a test-environment gap, not a
// production one, so it's stubbed globally here — the same posture as the ResizeObserver/
// DOMMatrixReadOnly stubs above — rather than guarded with a defensive `?.()` in production
// code for an environment that can't actually happen there.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

// Note for whoever next writes an interaction test against a component that mounts
// <BlockCanvas>: use fireEvent.click, not userEvent.click, on anything React-Flow-rendered
// (a node or the pane). React Flow's pane and draggable nodes attach their own native
// (non-React) d3-drag/d3-zoom mousedown listeners for real dragging; d3-drag's internal
// nodrag() unconditionally reads `event.view.document`, and jsdom's MouseEvent constructor
// leaves `view` null unless a caller sets it, so any interaction that fires a real mousedown
// throws there. userEvent.click() fires a full pointerdown/mousedown/mouseup/click sequence
// to simulate a real user (triggering this); fireEvent.click() fires only 'click', which is
// all RF's onNodeClick/onPaneClick/onEdgeClick actually listen for. Two attempts at patching
// this away globally instead — subclassing `MouseEvent` and patching
// `MouseEvent.prototype.view` via `Object.defineProperty` — were tried and both broke jsdom's
// own environment bootstrapping worse (reproduced "document is not defined" on unrelated
// renders), so this is fixed at the call site, not here.
