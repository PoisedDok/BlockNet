import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MicroFileEdge } from '@blocknet/core';
import type { WebviewMicroFileNode } from '../../src/shared/protocol.js';
import { FileCanvas } from '../src/flow/FileCanvas.js';

function file(id: string, opts: { dirty?: boolean; risk?: boolean } = {}): WebviewMicroFileNode {
  return { id, name: id, path: `packages/a/${id}`, loc: 10, dirty: opts.dirty ?? false, risk: opts.risk ?? false };
}

function edge(id: string, source: string, target: string, risk = false): MicroFileEdge {
  return { id, source, target, risk };
}

describe('FileCanvas', () => {
  const postMessage = vi.fn();

  beforeAll(() => {
    globalThis.acquireVsCodeApi = vi.fn(() => ({ postMessage }));
  });

  beforeEach(() => {
    postMessage.mockClear();
  });

  it('renders every file name', () => {
    const files = [file('a.ts'), file('b.ts')];
    render(<FileCanvas blockId="packages/a" blockName="a" files={files} edges={[]} onBack={() => {}} />);
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
  });

  it('shows the "System Map / <blockName>" breadcrumb', () => {
    render(<FileCanvas blockId="packages/a" blockName="a" files={[]} edges={[]} onBack={() => {}} />);
    expect(screen.getByText('System Map')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it('calls onBack when the breadcrumb root is clicked', async () => {
    const onBack = vi.fn();
    render(<FileCanvas blockId="packages/a" blockName="a" files={[]} edges={[]} onBack={onBack} />);
    fireEvent.click(screen.getByText('System Map'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls onBack when the "← zoom out to map" button is clicked', () => {
    const onBack = vi.fn();
    render(<FileCanvas blockId="packages/a" blockName="a" files={[]} edges={[]} onBack={onBack} />);
    fireEvent.click(screen.getByText(/zoom out to map/));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('counts exactly the risky files in the status bar', () => {
    const files = [file('a.ts', { risk: true }), file('b.ts'), file('c.ts', { risk: true })];
    render(<FileCanvas blockId="packages/a" blockName="a" files={files} edges={[]} onBack={() => {}} />);
    expect(screen.getByText('2 risks detected')).toBeInTheDocument();
  });

  it('shows the dirty marker only on files flagged dirty', () => {
    const files = [file('a.ts', { dirty: true }), file('b.ts', { dirty: false })];
    render(<FileCanvas blockId="packages/a" blockName="a" files={files} edges={[]} onBack={() => {}} />);
    const aCard = screen.getByText('a.ts').closest('.bn-file-card') as HTMLElement;
    const bCard = screen.getByText('b.ts').closest('.bn-file-card') as HTMLElement;
    expect(aCard.querySelector('.bn-file-card-dirty')).not.toBeNull();
    expect(bCard.querySelector('.bn-file-card-dirty')).toBeNull();
  });

  it('renders one risk badge ("!") per risky edge', () => {
    const files = [file('a.ts'), file('b.ts'), file('c.ts')];
    const edges = [edge('e1', 'a.ts', 'b.ts', true), edge('e2', 'b.ts', 'c.ts')];
    render(<FileCanvas blockId="packages/a" blockName="a" files={files} edges={edges} onBack={() => {}} />);
    expect(screen.getAllByText('!')).toHaveLength(1);
  });

  it('clicking a file\'s ⤢ button posts open/file with the file id', () => {
    const files = [file('a.ts')];
    render(<FileCanvas blockId="packages/a" blockName="a" files={files} edges={[]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /open a\.ts in editor/i }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'open/file', fileId: 'a.ts' });
  });

  describe('drag parity with BlockCanvas (ROADMAP-V2.md file-level drag parity)', () => {
    // Same arrow-key-movement technique BlockCanvas.test.tsx uses to exercise React Flow's
    // real onNodesChange/applyNodeChanges path headlessly — see that file's own comment for
    // why a real mousedown/mousemove/mouseup drag isn't constructible in this jsdom/vitest
    // combination (an explicit `view` on a synthesized MouseEvent throws).
    it('moves a file card position via onPositionChange and keeps it across a live prop update', () => {
      const onPositionChange = vi.fn();
      const files = [file('a.ts'), file('b.ts')];
      const { rerender } = render(
        <FileCanvas blockId="packages/a" blockName="a" files={files} edges={[]} onBack={() => {}} onPositionChange={onPositionChange} />,
      );
      const nodeEl = () => screen.getByText('a.ts').closest('.react-flow__node') as HTMLElement;
      const before = nodeEl().style.transform;

      fireEvent.click(nodeEl());
      fireEvent.keyDown(nodeEl(), { key: 'ArrowRight' });
      const afterMove = nodeEl().style.transform;

      expect(afterMove).not.toBe(before);
      expect(onPositionChange).toHaveBeenCalledWith('a.ts', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));

      // A fresh files/edges array (same ids) simulates a live re-render with no real position
      // change — the move must survive it, same as BlockCanvas's own regression test.
      rerender(
        <FileCanvas
          blockId="packages/a"
          blockName="a"
          files={[file('a.ts'), file('b.ts')]}
          edges={[]}
          onBack={() => {}}
          onPositionChange={onPositionChange}
        />,
      );
      expect(nodeEl().style.transform).toBe(afterMove);
    });

    // No jsdom regression test exists here for the real bug this component's
    // initialPositionsRef fixed (GraphView.tsx feeds a brand-new initialPositions object on
    // every drag frame; an earlier version that put initialPositions directly in
    // baseFlowNodes' dependency array produced React Flow's error #015, "trying to drag a
    // node that is not initialized," repeatedly, plus visible flicker, confirmed live).
    // Deliberately not attempted: this component's own reconciliation effect already
    // preserves an existing node's position unconditionally on every re-render regardless of
    // what baseFlowNodes recomputes to, so a jsdom test simulating the same "fresh
    // initialPositions every render" feedback via rerender() would pass identically whether
    // or not the bug were present — jsdom has no equivalent of React Flow's real internal
    // pointer-capture-driven drag state machine for the bug to actually corrupt. This is the
    // same category of gap this project's own prior sessions already hit and documented (see
    // docs/planning/PROGRESS-V2.md): live Playwright verification against a real dev server
    // is what actually proves this fix, not a unit test — confirmed RED (29 repeated #015
    // warnings during a real 40-step drag) against the pre-fix code, then GREEN after.

    it('seeds a file card from initialPositions when supplied', () => {
      const files = [file('a.ts')];
      render(
        <FileCanvas
          blockId="packages/a"
          blockName="a"
          files={files}
          edges={[]}
          onBack={() => {}}
          initialPositions={{ 'a.ts': { x: 777, y: 888 } }}
        />,
      );
      const nodeEl = screen.getByText('a.ts').closest('.react-flow__node') as HTMLElement;
      expect(nodeEl.style.transform).toContain('777px');
      expect(nodeEl.style.transform).toContain('888px');
    });

    it('renders the draggable "grab the line" affordance on a micro edge when onWaypointsChange is supplied', () => {
      const files = [file('a.ts'), file('b.ts')];
      const edges = [edge('e1', 'a.ts', 'b.ts')];
      const { container } = render(
        <FileCanvas blockId="packages/a" blockName="a" files={files} edges={edges} onBack={() => {}} onWaypointsChange={() => {}} />,
      );
      expect(container.querySelector('.bn-edge-grab')).not.toBeNull();
    });

    it('renders no grab affordance when onWaypointsChange is not supplied (no persistence wired)', () => {
      const files = [file('a.ts'), file('b.ts')];
      const edges = [edge('e1', 'a.ts', 'b.ts')];
      const { container } = render(<FileCanvas blockId="packages/a" blockName="a" files={files} edges={edges} onBack={() => {}} />);
      expect(container.querySelector('.bn-edge-grab')).toBeNull();
    });

    it('renders a waypoint handle for an existing waypoint passed via initialEdgeWaypoints', () => {
      const files = [file('a.ts'), file('b.ts')];
      const edges = [edge('e1', 'a.ts', 'b.ts')];
      const { container } = render(
        <FileCanvas
          blockId="packages/a"
          blockName="a"
          files={files}
          edges={edges}
          onBack={() => {}}
          onWaypointsChange={() => {}}
          initialEdgeWaypoints={{ e1: [{ x: 100, y: 60 }] }}
        />,
      );
      expect(container.querySelector('.bn-edge-waypoint-handle')).not.toBeNull();
    });
  });
});
