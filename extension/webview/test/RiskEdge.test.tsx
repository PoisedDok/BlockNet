import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { EdgeProps } from '@xyflow/react';
import { RiskEdge, type RiskEdgeType } from '../src/flow/RiskEdge.js';

function edgeProps(overrides: Partial<EdgeProps<RiskEdgeType>> = {}): EdgeProps<RiskEdgeType> {
  return {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: 30,
    targetX: 300,
    targetY: 30,
    sourcePosition: 'right' as never,
    targetPosition: 'left' as never,
    selected: false,
    data: { isRisk: false, dimmed: false },
    ...overrides,
  } as EdgeProps<RiskEdgeType>;
}

// RiskEdge takes no React Flow context (no hooks beyond BaseEdge, which is itself
// context-free) — it's a prop-driven SVG renderer, so it's testable with a plain <svg> host
// instead of a full <ReactFlowProvider>/<ReactFlow> harness.
function renderEdge(props: EdgeProps<RiskEdgeType>) {
  return render(
    <svg>
      <RiskEdge {...props} />
    </svg>,
  );
}

describe('RiskEdge', () => {
  it('renders a visible path between the two anchor points', () => {
    const { container } = renderEdge(edgeProps());
    const path = container.querySelector('.bn-edge-path, .react-flow__edge-path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('d')).toContain('M 0 30');
  });

  it('renders a port circle at each endpoint', () => {
    const { container } = renderEdge(edgeProps());
    const circles = container.querySelectorAll('circle.bn-edge-port');
    expect(circles).toHaveLength(2);
    expect(circles[0]?.getAttribute('cx')).toBe('0');
    expect(circles[1]?.getAttribute('cx')).toBe('300');
  });

  it('does not render a risk badge for a non-risk edge', () => {
    const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: false } }));
    expect(container.querySelector('.bn-edge-badge')).toBeNull();
  });

  it('renders a "!" risk badge at the true midpoint for a risky edge', () => {
    const { container, getByText } = renderEdge(edgeProps({ data: { isRisk: true, dimmed: false } }));
    expect(getByText('!')).toBeInTheDocument();
    const badge = container.querySelector('.bn-edge-badge');
    expect(badge?.getAttribute('transform')).toBe('translate(150, 30)');
  });

  it('marks the edge group data-risk for CSS styling when risky', () => {
    const { container } = renderEdge(edgeProps({ data: { isRisk: true, dimmed: false } }));
    expect(container.querySelector('g.bn-edge')?.hasAttribute('data-risk')).toBe(true);
  });

  it('dims a non-related edge via inline opacity', () => {
    const { container } = renderEdge(edgeProps({ data: { isRisk: false, dimmed: true } }));
    const group = container.querySelector('g.bn-edge') as HTMLElement;
    expect(group.style.opacity).toBe('0.1');
  });
});
