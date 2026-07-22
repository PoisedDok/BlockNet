import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerArrow } from '@blocknet/core';
import type { WebviewLayerItem } from '../../src/shared/protocol.js';
import { GraphView, type LayerPayload } from '../src/flow/GraphView.js';

function folderItem(id: string, name = id): WebviewLayerItem {
  return { kind: 'folder', id, name, path: id, isBlock: true, pills: [], fileCount: 1, riskCount: 0, dirty: false };
}

function fileItem(id: string, path: string): WebviewLayerItem {
  const name = path.split('/').at(-1) ?? path;
  return { kind: 'file', id, name, path, loc: 5, dirty: false, risk: false };
}

function layer0(items: WebviewLayerItem[]): LayerPayload {
  return { layerPath: '', items, edges: [], arrows: [] };
}

function layerAt(path: string, items: WebviewLayerItem[], arrows: LayerArrow[] = []): LayerPayload {
  return { layerPath: path, items, edges: [], arrows };
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

  it('renders layer 0 once its data arrives, with the floor-picker showing only the root slab', () => {
    render(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={() => {}} />);
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'System Map' })).toHaveLength(1);
  });

  it('double-clicking a folder card calls onRequestLayer with its id and shows a loading indicator', () => {
    const onRequestLayer = vi.fn();
    render(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
    fireEvent.doubleClick(screen.getByText('web'));
    expect(onRequestLayer).toHaveBeenCalledWith('apps/web');
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('cross-fades to the next layer once a matching graph/layer payload arrives', () => {
    const onRequestLayer = vi.fn();
    const { rerender } = render(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
    fireEvent.doubleClick(screen.getByText('web'));

    // Two separate act() calls, not one: the setTimeout(0) GraphView schedules to defer the
    // phase flip is only scheduled once React flushes the effect the rerender() below
    // triggers — which act() only does at the END of its callback, after this callback
    // returns. Calling vi.runAllTimers() inside the same act() callback would run BEFORE that
    // effect ever fires, finding nothing pending yet.
    act(() => {
      rerender(
        <GraphView
          layer={layerAt('apps/web', [fileItem('apps/web/index.ts', 'apps/web/index.ts')])}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('System Map')).toBeInTheDocument();
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('falls back to the previous layer with a banner when a matching graph/layer/error arrives', () => {
    const onRequestLayer = vi.fn();
    const { rerender } = render(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
    fireEvent.doubleClick(screen.getByText('web'));

    act(() => {
      rerender(
        <GraphView
          layer={layer0([folderItem('apps/web', 'web')])}
          onRequestLayer={onRequestLayer}
          layerError={{ layerPath: 'apps/web', message: 'no cache yet' }}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('no cache yet')).toBeInTheDocument();
    // Still parked at layer 0 — the floor-picker's stack never grew past the root slab, since
    // the navigation that would have pushed 'apps/web' onto it never settled.
    expect(screen.getAllByRole('button', { name: 'System Map' })).toHaveLength(1);
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
  });

  it('the error banner auto-clears after a few seconds', () => {
    const onRequestLayer = vi.fn();
    const { rerender } = render(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
    fireEvent.doubleClick(screen.getByText('web'));
    act(() => {
      rerender(
        <GraphView
          layer={layer0([folderItem('apps/web', 'web')])}
          onRequestLayer={onRequestLayer}
          layerError={{ layerPath: 'apps/web', message: 'no cache yet' }}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByText('no cache yet')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText('no cache yet')).not.toBeInTheDocument();
  });

  it('ignores a layer payload for a path that is no longer pending', () => {
    const onRequestLayer = vi.fn();
    const { rerender } = render(
      <GraphView layer={layer0([folderItem('apps/web', 'web'), folderItem('apps/api', 'api')])} onRequestLayer={onRequestLayer} />,
    );
    fireEvent.doubleClick(screen.getByText('web'));
    fireEvent.doubleClick(screen.getByText('api'));

    act(() => {
      rerender(
        <GraphView
          layer={layerAt('apps/web', [fileItem('apps/web/stale.ts', 'apps/web/stale.ts')])}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.queryByText('stale.ts')).not.toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('a superseded navigation\'s already-armed timer chain never applies its data after a newer one interrupts it', () => {
    // Regression test for the exact race the retired macro/micro GraphView's own two-pass
    // review found and fixed, generalized to arbitrary navigation: dive into 'apps/web' AFTER
    // its graph/layer response has already arrived and scheduled its two-tick mount-then-flip
    // timer chain, but BEFORE any of that chain has fired — then dive into 'apps/api' before
    // either fires. The old (pre-fix) shape only cancelled a scheduled timer as a side effect
    // of the SAME guard passing again on a later run; once the guard started failing, the
    // leftover timer fired anyway, applying stale data under the new identity. This component's
    // effects return their cleanup unconditionally, so React cancels them on every dependency
    // change regardless of which stage was in flight.
    const onRequestLayer = vi.fn();
    const { rerender } = render(
      <GraphView layer={layer0([folderItem('apps/web', 'web'), folderItem('apps/api', 'api')])} onRequestLayer={onRequestLayer} />,
    );
    fireEvent.doubleClick(screen.getByText('web'));

    act(() => {
      rerender(
        <GraphView
          layer={layerAt('apps/web', [fileItem('apps/web/a-file.ts', 'apps/web/a-file.ts')])}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    fireEvent.doubleClick(screen.getByText('api'));
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      rerender(
        <GraphView
          layer={layerAt('apps/api', [fileItem('apps/api/b-file.ts', 'apps/api/b-file.ts')])}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('b-file.ts')).toBeInTheDocument();
    expect(screen.queryByText('a-file.ts')).not.toBeInTheDocument();
  });

  it('a settle timer already armed by an earlier navigation never applies its stale data after a newer navigation interrupts it before it fires', () => {
    // A different, more subtle gap than the "superseded navigation" test above: that one
    // interrupts BEFORE the first navigation's mount-then-flip chain has started ticking at
    // all (still covered by the effect's own unconditional outerTimer/innerTimer cleanup). This
    // covers interrupting AFTER phase has already reached 'transitioning' and unmountTimer is
    // already armed for its OWN 500ms settle — found by architectural review, not a unit test:
    // the effect's guard-gated `clearTimeout(unmountTimer.current)` doesn't run again until the
    // SECOND navigation's own response arrives, so without navigateTo's own unconditional
    // clearTimeout, the orphaned first-navigation timer fires mid-flight and silently applies
    // stale data — wiping out the second navigation's still-in-flight pendingLayer entirely.
    const onRequestLayer = vi.fn();
    const { rerender } = render(
      <GraphView layer={layer0([folderItem('apps/web', 'web'), folderItem('apps/api', 'api')])} onRequestLayer={onRequestLayer} />,
    );
    fireEvent.doubleClick(screen.getByText('web'));
    act(() => {
      rerender(
        <GraphView
          layer={layerAt('apps/web', [fileItem('apps/web/a-file.ts', 'apps/web/a-file.ts')])}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    // Advance past the two 0ms ticks ONLY — reaches phase:'transitioning' with unmountTimer
    // armed for its own 500ms settle, without letting that settle fire yet.
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // A second navigation starts BEFORE the first one's still-pending settle fires.
    fireEvent.doubleClick(screen.getByText('api'));

    // Advance past the point where the FIRST navigation's orphaned settle timer would have
    // fired (500ms) if navigateTo hadn't cancelled it.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    act(() => {
      rerender(
        <GraphView
          layer={layerAt('apps/api', [fileItem('apps/api/b-file.ts', 'apps/api/b-file.ts')])}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('b-file.ts')).toBeInTheDocument();
    expect(screen.queryByText('a-file.ts')).not.toBeInTheDocument();
  });

  describe('drag persistence across navigation', () => {
    it('threads initialPositions/initialEdgeWaypoints into a dove-into layer', () => {
      const onRequestLayer = vi.fn();
      const { rerender } = render(
        <GraphView
          layer={layer0([folderItem('apps/web', 'web')])}
          onRequestLayer={onRequestLayer}
          initialPositions={{ 'apps/web/index.ts': { x: 555, y: 666 } }}
        />,
      );
      fireEvent.doubleClick(screen.getByText('web'));
      act(() => {
        rerender(
          <GraphView
            layer={layerAt('apps/web', [fileItem('apps/web/index.ts', 'apps/web/index.ts')])}
            onRequestLayer={onRequestLayer}
            initialPositions={{ 'apps/web/index.ts': { x: 555, y: 666 } }}
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

    it('persists a drag as one unified layout/persist message', () => {
      const onRequestLayer = vi.fn();
      const { rerender } = render(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
      fireEvent.doubleClick(screen.getByText('web'));
      act(() => {
        rerender(
          <GraphView
            layer={layerAt('apps/web', [fileItem('apps/web/index.ts', 'apps/web/index.ts')])}
            onRequestLayer={onRequestLayer}
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

      const persistCall = postMessage.mock.calls.find((call) => call[0]?.type === 'layout/persist');
      expect(persistCall).toBeDefined();
      expect(persistCall?.[0].positions['apps/web/index.ts']).toBeDefined();
    });

    it('a same-session re-dive into a previously-visited layer keeps its dragged position', () => {
      // The whole reason GraphView (not LayerCanvas) owns the camera-store instance:
      // LayerCanvas remounts fresh on every navigation (even back into the same layer), so
      // only state that outlives that remount boundary can survive a "drag, go back, dive
      // back in" round trip within one session.
      const onRequestLayer = vi.fn();
      const { rerender } = render(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
      fireEvent.doubleClick(screen.getByText('web'));
      act(() => {
        rerender(
          <GraphView
            layer={layerAt('apps/web', [fileItem('apps/web/index.ts', 'apps/web/index.ts')])}
            onRequestLayer={onRequestLayer}
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

      act(() => fireEvent.click(screen.getByText('System Map')));
      act(() => {
        rerender(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
      });
      act(() => {
        vi.runAllTimers();
      });

      fireEvent.doubleClick(screen.getByText('web'));
      act(() => {
        rerender(
          <GraphView
            layer={layerAt('apps/web', [fileItem('apps/web/index.ts', 'apps/web/index.ts')])}
            onRequestLayer={onRequestLayer}
          />,
        );
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(nodeEl().style.transform).toBe(moved);
    });
  });

  it('the floor-picker can jump straight to an ancestor MULTIPLE levels up, not just one back', () => {
    // The capability the floor-picker adds beyond a simple back button: root -> apps ->
    // apps/web, then jump directly back to root in one click, skipping 'apps' entirely.
    // 'Apps Folder' as a display name distinct from its path ('apps') — a real single-segment
    // top-level folder legitimately has name === path (basename of a one-segment path is the
    // whole path), which would otherwise make BlockCard render "apps" twice (once as the name
    // span, once as the path span) and break getByText('apps') with a false ambiguity that has
    // nothing to do with what this test actually checks.
    const onRequestLayer = vi.fn();
    const { rerender } = render(<GraphView layer={layer0([folderItem('apps', 'Apps Folder')])} onRequestLayer={onRequestLayer} />);
    fireEvent.doubleClick(screen.getByText('Apps Folder'));
    act(() => {
      rerender(<GraphView layer={layerAt('apps', [folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
    });
    act(() => {
      vi.runAllTimers();
    });
    fireEvent.doubleClick(screen.getByText('web'));
    act(() => {
      rerender(
        <GraphView
          layer={layerAt('apps/web', [fileItem('apps/web/index.ts', 'apps/web/index.ts')])}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toEqual(
      expect.arrayContaining([expect.objectContaining({ textContent: 'System Map' }), expect.objectContaining({ textContent: 'Apps Folder' })]),
    );

    // Jump straight to root — 'Apps Folder' is never requested again.
    act(() => fireEvent.click(screen.getByText('System Map')));
    expect(onRequestLayer).toHaveBeenLastCalledWith('');
    act(() => {
      rerender(<GraphView layer={layer0([folderItem('apps', 'Apps Folder')])} onRequestLayer={onRequestLayer} />);
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getAllByRole('button', { name: 'System Map' })).toHaveLength(1);
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
  });

  it('clicking an inter-layer arrow reconstructs the FULL ancestor chain to an unrelated branch, not an extension of the current stack', () => {
    const onRequestLayer = vi.fn();
    const arrowToUnrelatedBranch = [
      { id: 'arrow1', sourceItemId: 'apps/web/index.ts', targetFile: 'services/legacy/old.ts', direction: 'up' as const, risk: false },
    ];
    const { rerender } = render(<GraphView layer={layer0([folderItem('apps', 'Apps Folder')])} onRequestLayer={onRequestLayer} />);
    fireEvent.doubleClick(screen.getByText('Apps Folder'));
    act(() => {
      rerender(<GraphView layer={layerAt('apps', [folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
    });
    act(() => {
      vi.runAllTimers();
    });
    fireEvent.doubleClick(screen.getByText('web'));
    act(() => {
      rerender(
        <GraphView
          layer={layerAt('apps/web', [fileItem('apps/web/index.ts', 'apps/web/index.ts')], arrowToUnrelatedBranch)}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    // Now at apps/web, with an arrow pointing at services/legacy/old.ts (an unrelated branch).
    fireEvent.click(screen.getByText('old.ts'));
    expect(onRequestLayer).toHaveBeenLastCalledWith('services/legacy');

    act(() => {
      rerender(
        <GraphView
          layer={layerAt('services/legacy', [fileItem('services/legacy/old.ts', 'services/legacy/old.ts')], arrowToUnrelatedBranch)}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });

    // The floor-picker shows the REAL chain to the new location (root -> services -> legacy),
    // not 'apps'/'web' extended with the new path, and not a broken/partial trail either.
    const floorPicker = document.querySelector('.bn-floor-picker') as HTMLElement;
    const slabLabels = [...floorPicker.querySelectorAll('.bn-floor-slab')].map((el) => el.textContent);
    expect(slabLabels).toEqual(['System Map', 'services', 'legacy']);
  });

  it('clicking back navigates to the parent layer', () => {
    const onRequestLayer = vi.fn();
    const { rerender } = render(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
    fireEvent.doubleClick(screen.getByText('web'));

    act(() => {
      rerender(
        <GraphView
          layer={layerAt('apps/web', [fileItem('apps/web/index.ts', 'apps/web/index.ts')])}
          onRequestLayer={onRequestLayer}
        />,
      );
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByText('index.ts')).toBeInTheDocument();

    act(() => fireEvent.click(screen.getByText('System Map')));
    expect(onRequestLayer).toHaveBeenLastCalledWith('');

    act(() => {
      rerender(<GraphView layer={layer0([folderItem('apps/web', 'web')])} onRequestLayer={onRequestLayer} />);
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
  });
});
