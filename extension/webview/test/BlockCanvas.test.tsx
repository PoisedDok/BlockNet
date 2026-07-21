import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BlockNode, Edge, Risk } from '@blocknet/core';
import { BlockCanvas } from '../src/flow/BlockCanvas.js';

function block(id: string, riskCount = 0): BlockNode {
  return { id, name: id, path: `packages/${id}`, pills: ['typescript'], fileCount: 3, riskCount };
}

function risk(): Risk {
  return { tag: 'CIRCULAR', oneLine: 'a cycle', explain: 'explain', fix: 'fix', source: 'a', target: 'b', evidence: [] };
}

function edge(id: string, source: string, target: string, withRisk = false): Edge {
  return { id, source, target, importCount: 1, ...(withRisk ? { risk: risk() } : {}) };
}

describe('BlockCanvas', () => {
  it('renders every block name', () => {
    const nodes = [block('gateway'), block('auth'), block('web')];
    render(<BlockCanvas nodes={nodes} edges={[]} />);
    expect(screen.getByText('gateway')).toBeInTheDocument();
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
  });

  it('shows a zero risk count in the status bar when nothing is flagged', () => {
    const nodes = [block('gateway'), block('auth')];
    render(<BlockCanvas nodes={nodes} edges={[edge('e1', 'gateway', 'auth')]} />);
    expect(screen.getByText('0 risks detected')).toBeInTheDocument();
  });

  it('counts exactly the edges carrying a risk in the status bar', () => {
    const nodes = [block('gateway'), block('auth'), block('web')];
    const edges = [edge('e1', 'gateway', 'auth', true), edge('e2', 'auth', 'web')];
    render(<BlockCanvas nodes={nodes} edges={edges} />);
    expect(screen.getByText('1 risk detected')).toBeInTheDocument();
  });

  it('dims an unrelated node after selecting a different node, and clears on pane click', () => {
    // fireEvent.click (not userEvent.click): React Flow's onNodeClick/onPaneClick are wired
    // to the DOM 'click' event alone, and firing only that — instead of userEvent's full
    // realistic pointerdown/mousedown/mouseup/click sequence — avoids ever triggering
    // mousedown on a node or pane. That matters here because RF's pane/nodes also carry
    // their own native (non-React) d3-drag/d3-zoom mousedown listeners for real dragging,
    // and d3-drag's internal nodrag() throws on a jsdom-synthesized event whose `view` isn't
    // set (jsdom itself doesn't set it, and neither fireEvent nor userEvent do either) — a
    // jsdom/d3 interaction gap, not something our component or this interaction depends on.
    const nodes = [block('gateway'), block('auth'), block('web')];
    const edges = [edge('e1', 'gateway', 'auth')];
    const { container } = render(<BlockCanvas nodes={nodes} edges={edges} />);

    const webCardBefore = screen.getByText('web').closest('.bn-card') as HTMLElement;
    expect(webCardBefore.style.opacity).toBe('1');

    fireEvent.click(screen.getByText('gateway'));
    const webCardAfter = screen.getByText('web').closest('.bn-card') as HTMLElement;
    expect(webCardAfter.style.opacity).toBe('0.14');
    const gatewayCard = screen.getByText('gateway').closest('.bn-card') as HTMLElement;
    expect(gatewayCard.style.opacity).toBe('1');

    // Clicking empty canvas clears the selection again.
    const pane = container.querySelector('.react-flow__pane') as HTMLElement;
    fireEvent.click(pane);
    const webCardCleared = screen.getByText('web').closest('.bn-card') as HTMLElement;
    expect(webCardCleared.style.opacity).toBe('1');
  });

  it('renders one risk badge ("!") per risky edge', () => {
    const nodes = [block('gateway'), block('auth'), block('web')];
    const edges = [edge('e1', 'gateway', 'auth', true), edge('e2', 'auth', 'web')];
    render(<BlockCanvas nodes={nodes} edges={edges} />);
    expect(screen.getAllByText('!')).toHaveLength(1);
  });

  it('persists a node position after a move (drag-equivalent commit path)', () => {
    // React Flow runs in controlled mode here (nodes/edges come from props, recomputed via
    // useMemo, not defaultNodes/defaultEdges) — without an onNodesChange handler committing
    // position changes back into state, RF computes a moved position internally and then
    // discards it on the very next render, since `hasDefaultNodes` (the flag that makes RF
    // self-manage position) is only set when a defaultNodes prop is supplied. Two-pass
    // review's architectural-soundness lane found this by tracing @xyflow/react's own
    // triggerNodeChanges source. This test pins the fix via RF's keyboard-driven node
    // movement (arrow keys on a selected, draggable node — @xyflow/react's own NodeWrapper
    // onKeyDown, gated on node.selected), which commits through the exact same
    // onNodesChange path a mouse drag does, rather than via a real mousedown/mousemove/
    // mouseup gesture: constructing a MouseEvent with an explicit `view` throws
    // "member view is not of type Window" in this exact jsdom/vitest combination even for
    // the most minimal possible case (confirmed directly: `window instanceof Window` is
    // `false` here, a jsdom/vitest module-duplication issue, not something in our control) —
    // arrow-key movement exercises the identical bug without needing a real drag gesture.
    const nodes = [block('gateway'), block('auth')];
    render(<BlockCanvas nodes={nodes} edges={[]} />);
    const nodeEl = screen.getByText('gateway').closest('.react-flow__node') as HTMLElement;
    const before = nodeEl.style.transform;

    fireEvent.click(nodeEl); // select it — arrow-key movement only applies to a selected node
    fireEvent.keyDown(nodeEl, { key: 'ArrowRight' });

    expect(nodeEl.style.transform).not.toBe(before);
  });

  it('renders 30 blocks and 100 edges without throwing (stress fixture size)', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => block(`n${i}`));
    const edges = Array.from({ length: 100 }, (_, i) => edge(`e${i}`, `n${i % 30}`, `n${(i * 7 + 3) % 30}`)).filter(
      (e) => e.source !== e.target,
    );
    expect(() => render(<BlockCanvas nodes={nodes} edges={edges} />)).not.toThrow();
  });
});
