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
    expect(postMessage).toHaveBeenCalledWith({ type: 'layout/persist', positions: { a: { x: 5, y: 6 } } });
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
});
