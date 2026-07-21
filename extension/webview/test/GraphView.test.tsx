import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebviewBlockNode, WebviewMicroFileNode } from '../../src/shared/protocol.js';
import { GraphView } from '../src/flow/GraphView.js';

function block(id: string): WebviewBlockNode {
  return { id, name: id, path: `packages/${id}`, pills: [], fileCount: 1, riskCount: 0, dirty: false };
}

function file(id: string): WebviewMicroFileNode {
  return { id, name: id, path: `packages/a/${id}`, loc: 5, dirty: false, risk: false };
}

describe('GraphView', () => {
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

  it('renders only the macro layer by default', () => {
    render(<GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={() => {}} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.queryByText('System Map')).not.toBeInTheDocument();
  });

  it('double-clicking a block calls onRequestMicro with its id and shows a loading indicator', () => {
    const onRequestMicro = vi.fn();
    render(<GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={onRequestMicro} />);
    fireEvent.doubleClick(screen.getByText('a'));
    expect(onRequestMicro).toHaveBeenCalledWith('a');
    expect(screen.getByText(/loading files/i)).toBeInTheDocument();
  });

  it('cross-fades to the micro view once a matching graph/micro payload arrives', () => {
    const onRequestMicro = vi.fn();
    const { rerender } = render(<GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={onRequestMicro} />);
    fireEvent.doubleClick(screen.getByText('a'));

    // Two separate act() calls, not one: the setTimeout(0) GraphView schedules to defer the
    // phase flip (see GraphView.tsx's own comment) is only scheduled once React flushes the
    // effect the rerender() below triggers — which act() only does at the END of its callback,
    // after this callback returns. Calling vi.runAllTimers() inside the same act()
    // callback would run BEFORE that effect ever fires, finding nothing pending yet.
    act(() => {
      rerender(
        <GraphView
          macroNodes={[block('a')]}
          macroEdges={[]}
          onRequestMicro={onRequestMicro}
          micro={{ blockId: 'a', files: [file('index.ts')], edges: [] }}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('System Map')).toBeInTheDocument();
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.queryByText(/loading files/i)).not.toBeInTheDocument();
  });

  it('falls back to macro with a banner when a matching graph/micro/error arrives', () => {
    const onRequestMicro = vi.fn();
    const { rerender } = render(<GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={onRequestMicro} />);
    fireEvent.doubleClick(screen.getByText('a'));

    act(() => {
      rerender(
        <GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={onRequestMicro} microError={{ blockId: 'a', message: 'no cache yet' }} />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('no cache yet')).toBeInTheDocument();
    expect(screen.queryByText('System Map')).not.toBeInTheDocument();
    expect(screen.queryByText(/loading files/i)).not.toBeInTheDocument();
  });

  it('the error banner auto-clears after a few seconds', () => {
    const onRequestMicro = vi.fn();
    const { rerender } = render(<GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={onRequestMicro} />);
    fireEvent.doubleClick(screen.getByText('a'));
    act(() => {
      rerender(
        <GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={onRequestMicro} microError={{ blockId: 'a', message: 'no cache yet' }} />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByText('no cache yet')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText('no cache yet')).not.toBeInTheDocument();
  });

  it('ignores a micro payload for a block that is no longer pending', () => {
    const onRequestMicro = vi.fn();
    const { rerender } = render(<GraphView macroNodes={[block('a'), block('b')]} macroEdges={[]} onRequestMicro={onRequestMicro} />);
    fireEvent.doubleClick(screen.getByText('a'));
    fireEvent.doubleClick(screen.getByText('b'));

    act(() => {
      rerender(
        <GraphView
          macroNodes={[block('a'), block('b')]}
          macroEdges={[]}
          onRequestMicro={onRequestMicro}
          micro={{ blockId: 'a', files: [file('stale.ts')], edges: [] }}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.queryByText('stale.ts')).not.toBeInTheDocument();
    expect(screen.getByText(/loading files/i)).toBeInTheDocument();
  });

  it('a superseded dive\'s already-armed timer chain never applies its data after a newer dive interrupts it', () => {
    // Regression test for a real race two-pass review found and reproduced: unlike the test
    // above (where the second dive happens before the first's response ever arrives, so its
    // effect guard never passes even once), this dives into 'b' AFTER 'a's graph/micro has
    // already arrived and scheduled its two-tick mount-then-flip timer chain, but BEFORE any
    // of that chain has fired. The old implementation only cancelled a scheduled timer as a
    // side effect of the SAME guard passing again on the next effect run — once the guard
    // started failing (pendingBlockId moved to 'b'), the leftover 'a' timer was never
    // cancelled and fired anyway, applying 'a's data under 'b's identity and clobbering
    // pendingBlockId so 'b's real response was silently dropped. The fix (GraphView.tsx)
    // returns the scheduled timer(s) from the effect's own cleanup function unconditionally,
    // so React cancels them on every dependency change, not only when the guard re-passes.
    const onRequestMicro = vi.fn();
    const { rerender } = render(<GraphView macroNodes={[block('a'), block('b')]} macroEdges={[]} onRequestMicro={onRequestMicro} />);
    fireEvent.doubleClick(screen.getByText('a'));

    act(() => {
      rerender(
        <GraphView
          macroNodes={[block('a'), block('b')]}
          macroEdges={[]}
          onRequestMicro={onRequestMicro}
          micro={{ blockId: 'a', files: [file('a-file.ts')], edges: [] }}
        />,
      );
    });
    // 'a's outer timer is now scheduled but not yet flushed — dive into 'b' before it fires,
    // and flush BEFORE 'b's response arrives (not after, unlike the "ignores a micro payload"
    // test above): this is what lets 'a's stale, never-cancelled timer chain actually run to
    // completion — applying 'a's data and flipping phase to 'micro' — before 'b's real
    // response ever gets a chance to be processed.
    fireEvent.doubleClick(screen.getByText('b'));
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      rerender(
        <GraphView
          macroNodes={[block('a'), block('b')]}
          macroEdges={[]}
          onRequestMicro={onRequestMicro}
          micro={{ blockId: 'b', files: [file('b-file.ts')], edges: [] }}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('b-file.ts')).toBeInTheDocument();
    expect(screen.queryByText('a-file.ts')).not.toBeInTheDocument();
  });

  describe('file-level drag parity (ROADMAP-V2.md)', () => {
    it('threads initialFilePositions/initialFileEdgeWaypoints into a dove-into FileCanvas', () => {
      const onRequestMicro = vi.fn();
      const { rerender } = render(
        <GraphView
          macroNodes={[block('a')]}
          macroEdges={[]}
          onRequestMicro={onRequestMicro}
          initialFilePositions={{ 'index.ts': { x: 555, y: 666 } }}
        />,
      );
      fireEvent.doubleClick(screen.getByText('a'));
      act(() => {
        rerender(
          <GraphView
            macroNodes={[block('a')]}
            macroEdges={[]}
            onRequestMicro={onRequestMicro}
            initialFilePositions={{ 'index.ts': { x: 555, y: 666 } }}
            micro={{ blockId: 'a', files: [file('index.ts')], edges: [] }}
          />,
        );
      });
      act(() => {
        vi.runAllTimers();
      });
      const nodeEl = screen.getByText('index.ts').closest('.react-flow__node') as HTMLElement;
      expect(nodeEl.style.transform).toContain('555px');
      expect(nodeEl.style.transform).toContain('666px');
    });

    it('persists a file drag as layout/file-persist, independent of the macro layout/persist message', () => {
      const onRequestMicro = vi.fn();
      const { rerender } = render(<GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={onRequestMicro} />);
      fireEvent.doubleClick(screen.getByText('a'));
      act(() => {
        rerender(
          <GraphView
            macroNodes={[block('a')]}
            macroEdges={[]}
            onRequestMicro={onRequestMicro}
            micro={{ blockId: 'a', files: [file('index.ts')], edges: [] }}
          />,
        );
      });
      act(() => {
        vi.runAllTimers();
      });

      const nodeEl = screen.getByText('index.ts').closest('.react-flow__node') as HTMLElement;
      fireEvent.click(nodeEl);
      fireEvent.keyDown(nodeEl, { key: 'ArrowRight' });

      act(() => vi.advanceTimersByTime(300));

      const filePersistCall = postMessage.mock.calls.find((call) => call[0]?.type === 'layout/file-persist');
      expect(filePersistCall).toBeDefined();
      expect(filePersistCall?.[0].filePositions['index.ts']).toBeDefined();
      expect(postMessage.mock.calls.some((call) => call[0]?.type === 'layout/persist' && Object.keys(call[0].positions ?? {}).length > 0)).toBe(
        false,
      );
    });

    it('a same-session re-dive into a previously-visited block keeps its dragged file position', () => {
      // The whole reason GraphView.tsx (not FileCanvas.tsx) owns the file-camera-store
      // instance: FileCanvas remounts fresh on every dive (even back into the same block), so
      // only state that outlives that remount boundary can survive a "drag, go back, dive back
      // in" round trip within one session.
      const onRequestMicro = vi.fn();
      const { rerender } = render(<GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={onRequestMicro} />);
      fireEvent.doubleClick(screen.getByText('a'));
      act(() => {
        rerender(
          <GraphView
            macroNodes={[block('a')]}
            macroEdges={[]}
            onRequestMicro={onRequestMicro}
            micro={{ blockId: 'a', files: [file('index.ts')], edges: [] }}
          />,
        );
      });
      act(() => {
        vi.runAllTimers();
      });

      const nodeEl = () => screen.getByText('index.ts').closest('.react-flow__node') as HTMLElement;
      fireEvent.click(nodeEl());
      fireEvent.keyDown(nodeEl(), { key: 'ArrowRight' });
      const moved = nodeEl().style.transform;

      act(() => fireEvent.click(screen.getByText(/zoom out to map/)));
      act(() => vi.advanceTimersByTime(500)); // GraphView's TRANSITION_MS unmount delay

      fireEvent.doubleClick(screen.getByText('a'));
      act(() => {
        rerender(
          <GraphView
            macroNodes={[block('a')]}
            macroEdges={[]}
            onRequestMicro={onRequestMicro}
            micro={{ blockId: 'a', files: [file('index.ts')], edges: [] }}
          />,
        );
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(nodeEl().style.transform).toBe(moved);
    });
  });

  it('clicking back returns to the macro view', () => {
    const onRequestMicro = vi.fn();
    const { rerender } = render(<GraphView macroNodes={[block('a')]} macroEdges={[]} onRequestMicro={onRequestMicro} />);
    fireEvent.doubleClick(screen.getByText('a'));

    act(() => {
      rerender(
        <GraphView
          macroNodes={[block('a')]}
          macroEdges={[]}
          onRequestMicro={onRequestMicro}
          micro={{ blockId: 'a', files: [file('index.ts')], edges: [] }}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByText('index.ts')).toBeInTheDocument();

    act(() => fireEvent.click(screen.getByText(/zoom out to map/)));
    const macroLayer = document.querySelector('.bn-macro-layer') as HTMLElement;
    expect(macroLayer.hasAttribute('data-hidden')).toBe(false);

    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
  });
});
