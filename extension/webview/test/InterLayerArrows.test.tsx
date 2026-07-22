import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { LayerArrow } from '@blocknet/core';
import { InterLayerArrows } from '../src/flow/InterLayerArrows.js';

function arrow(overrides: Partial<LayerArrow> = {}): LayerArrow {
  return { id: 'a1', sourceItemId: 'apps/web', targetFile: 'services/api/deep/file.ts', direction: 'down', risk: false, ...overrides };
}

describe('InterLayerArrows', () => {
  it('renders nothing when there are no arrows', () => {
    const { container } = render(<InterLayerArrows arrows={[]} onNavigate={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one button per arrow, labeled with the target file\'s basename', () => {
    render(<InterLayerArrows arrows={[arrow()]} onNavigate={() => {}} />);
    expect(screen.getByText('file.ts')).toBeInTheDocument();
  });

  it('shows a down chevron for a "down" direction arrow', () => {
    render(<InterLayerArrows arrows={[arrow({ direction: 'down' })]} onNavigate={() => {}} />);
    expect(screen.getByRole('button').textContent).toContain('↓');
  });

  it('shows an up chevron for an "up" direction arrow', () => {
    render(<InterLayerArrows arrows={[arrow({ direction: 'up' })]} onNavigate={() => {}} />);
    expect(screen.getByRole('button').textContent).toContain('↑');
  });

  it('marks a risky arrow with data-risk', () => {
    render(<InterLayerArrows arrows={[arrow({ risk: true })]} onNavigate={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-risk', 'true');
  });

  it('does not mark a non-risky arrow with data-risk', () => {
    render(<InterLayerArrows arrows={[arrow({ risk: false })]} onNavigate={() => {}} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('data-risk');
  });

  it('calls onNavigate with the arrow\'s targetFile when clicked', () => {
    const onNavigate = vi.fn();
    render(<InterLayerArrows arrows={[arrow({ targetFile: 'apps/api/x.ts' })]} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onNavigate).toHaveBeenCalledWith('apps/api/x.ts');
  });

  it('renders a separate button for each distinct arrow', () => {
    render(
      <InterLayerArrows
        arrows={[arrow({ id: 'a1', targetFile: 'apps/api/one.ts' }), arrow({ id: 'a2', targetFile: 'apps/api/two.ts' })]}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
