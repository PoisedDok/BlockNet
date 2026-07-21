import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCameraStore } from '../src/camera-store.js';

describe('useCameraStore', () => {
  // acquireVsCodeApi() is memoized inside host-bridge.ts and only ever called once per test
  // file (real VS Code constraint) — the mock (and the postMessage spy it returns) is shared
  // across every test here and cleared, not replaced, so a later test can't silently miss
  // calls routed to an earlier test's now-stale mock instance.
  const postMessage = vi.fn();

  beforeAll(() => {
    globalThis.acquireVsCodeApi = vi.fn(() => ({ postMessage }));
  });

  beforeEach(() => {
    postMessage.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with the initial (restored) positions and does not persist on mount', () => {
    const { result } = renderHook(() => useCameraStore({ a: { x: 1, y: 2 } }));
    expect(result.current.positions).toEqual({ a: { x: 1, y: 2 } });
    vi.advanceTimersByTime(1000);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('movePosition updates local state immediately (optimistic)', () => {
    const { result } = renderHook(() => useCameraStore({}));
    act(() => result.current.movePosition('a', { x: 10, y: 20 }));
    expect(result.current.positions).toEqual({ a: { x: 10, y: 20 } });
  });

  it('debounces layout/persist ~300ms after the last move, sending the full current map', () => {
    const { result } = renderHook(() => useCameraStore({ existing: { x: 0, y: 0 } }));
    act(() => result.current.movePosition('a', { x: 1, y: 1 }));
    vi.advanceTimersByTime(100);
    expect(postMessage).not.toHaveBeenCalled();
    act(() => result.current.movePosition('a', { x: 2, y: 2 }));
    vi.advanceTimersByTime(299);
    expect(postMessage).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'layout/persist',
      positions: { existing: { x: 0, y: 0 }, a: { x: 2, y: 2 } },
      edgeWaypoints: {},
    });
  });

  it('coalesces multiple moves within the debounce window into one persist call', () => {
    const { result } = renderHook(() => useCameraStore({}));
    act(() => result.current.movePosition('a', { x: 1, y: 1 }));
    act(() => vi.advanceTimersByTime(150));
    act(() => result.current.movePosition('b', { x: 2, y: 2 }));
    act(() => vi.advanceTimersByTime(300));
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'layout/persist',
      positions: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
      edgeWaypoints: {},
    });
  });

  it('flushes a still-pending persist immediately on unmount instead of losing it', () => {
    const { result, unmount } = renderHook(() => useCameraStore({}));
    act(() => result.current.movePosition('a', { x: 5, y: 6 }));
    // Well within the 300ms debounce window — nothing posted yet.
    act(() => vi.advanceTimersByTime(50));
    expect(postMessage).not.toHaveBeenCalled();
    unmount();
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'layout/persist', positions: { a: { x: 5, y: 6 } }, edgeWaypoints: {} });
  });

  it('does not double-post on unmount when nothing was pending', () => {
    const { result, unmount } = renderHook(() => useCameraStore({}));
    act(() => result.current.movePosition('a', { x: 5, y: 6 }));
    act(() => vi.advanceTimersByTime(300));
    expect(postMessage).toHaveBeenCalledTimes(1);
    postMessage.mockClear();
    unmount();
    expect(postMessage).not.toHaveBeenCalled();
  });

  describe('edge waypoints (ROADMAP-V2.md multi-point draggable/bendable edge routing)', () => {
    it('starts with the initial (restored) edge waypoints', () => {
      const { result } = renderHook(() => useCameraStore({}, { e1: [{ x: 10, y: 20 }] }));
      expect(result.current.edgeWaypoints).toEqual({ e1: [{ x: 10, y: 20 }] });
    });

    it('moveWaypoints updates local state immediately (optimistic), replacing the full array', () => {
      const { result } = renderHook(() => useCameraStore({}));
      act(() => result.current.moveWaypoints('e1', [{ x: 30, y: 40 }]));
      expect(result.current.edgeWaypoints).toEqual({ e1: [{ x: 30, y: 40 }] });
    });

    it('moveWaypoints(id, []) removes the override entirely, not sets it to an empty array', () => {
      const { result } = renderHook(() => useCameraStore({}, { e1: [{ x: 30, y: 40 }] }));
      act(() => result.current.moveWaypoints('e1', []));
      expect(result.current.edgeWaypoints).toEqual({});
    });

    it('a position move and a waypoints move share one debounced persist, sent together', () => {
      const { result } = renderHook(() => useCameraStore({}));
      act(() => result.current.movePosition('a', { x: 1, y: 1 }));
      act(() => vi.advanceTimersByTime(150));
      act(() => result.current.moveWaypoints('e1', [{ x: 2, y: 2 }]));
      act(() => vi.advanceTimersByTime(300));
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith({
        type: 'layout/persist',
        positions: { a: { x: 1, y: 1 } },
        edgeWaypoints: { e1: [{ x: 2, y: 2 }] },
      });
    });

    it('flushes a still-pending waypoints move immediately on unmount', () => {
      const { result, unmount } = renderHook(() => useCameraStore({}));
      act(() => result.current.moveWaypoints('e1', [{ x: 7, y: 8 }]));
      act(() => vi.advanceTimersByTime(50));
      expect(postMessage).not.toHaveBeenCalled();
      unmount();
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith({ type: 'layout/persist', positions: {}, edgeWaypoints: { e1: [{ x: 7, y: 8 }] } });
    });
  });

  describe('custom persist callback (file-level drag parity, ROADMAP-V2.md)', () => {
    // GraphView.tsx owns a SECOND, independent useCameraStore instance for file positions/
    // waypoints (survives FileCanvas's own per-dive remounts) — it must post a different
    // message shape (`layout/file-persist`) than the default macro one, so the host can tell
    // the two view-state domains apart and never clobber one with the other's data.
    it('calls the supplied persist callback instead of posting layout/persist directly', () => {
      const persist = vi.fn();
      const { result } = renderHook(() => useCameraStore({}, {}, persist));
      act(() => result.current.movePosition('src/a.ts', { x: 1, y: 1 }));
      act(() => vi.advanceTimersByTime(300));
      expect(postMessage).not.toHaveBeenCalled();
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledWith({ 'src/a.ts': { x: 1, y: 1 } }, {});
    });

    it('flushes the custom persist callback on unmount too', () => {
      const persist = vi.fn();
      const { result, unmount } = renderHook(() => useCameraStore({}, {}, persist));
      act(() => result.current.moveWaypoints('e1', [{ x: 3, y: 4 }]));
      act(() => vi.advanceTimersByTime(50));
      expect(persist).not.toHaveBeenCalled();
      unmount();
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledWith({}, { e1: [{ x: 3, y: 4 }] });
      expect(postMessage).not.toHaveBeenCalled();
    });

    it('defaults to posting layout/persist when no persist callback is supplied', () => {
      const { result } = renderHook(() => useCameraStore({}));
      act(() => result.current.movePosition('a', { x: 1, y: 1 }));
      act(() => vi.advanceTimersByTime(300));
      expect(postMessage).toHaveBeenCalledWith({ type: 'layout/persist', positions: { a: { x: 1, y: 1 } }, edgeWaypoints: {} });
    });
  });
});
