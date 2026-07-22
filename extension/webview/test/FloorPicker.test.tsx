import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FloorPicker } from '../src/ui/FloorPicker.js';

describe('FloorPicker', () => {
  it('renders one slab per stack entry, root first', () => {
    const stack = [
      { path: '', name: 'System Map' },
      { path: 'apps', name: 'apps' },
      { path: 'apps/web', name: 'web' },
    ];
    render(<FloorPicker stack={stack} onJumpTo={() => {}} />);
    const slabs = screen.getAllByRole('button');
    expect(slabs.map((s) => s.textContent)).toEqual(['System Map', 'apps', 'web']);
  });

  it('always labels the root slab "System Map", regardless of its actual name', () => {
    const stack = [{ path: '', name: 'some-weird-root-name' }];
    render(<FloorPicker stack={stack} onJumpTo={() => {}} />);
    expect(screen.getByText('System Map')).toBeInTheDocument();
  });

  it('marks only the LAST (deepest) entry as current', () => {
    const stack = [
      { path: '', name: 'System Map' },
      { path: 'apps/web', name: 'web' },
    ];
    render(<FloorPicker stack={stack} onJumpTo={() => {}} />);
    expect(screen.getByText('System Map')).not.toHaveAttribute('data-current');
    expect(screen.getByText('web')).toHaveAttribute('data-current', 'true');
    expect(screen.getByText('web')).toHaveAttribute('aria-current', 'true');
  });

  it('calls onJumpTo with the clicked slab\'s index', () => {
    const onJumpTo = vi.fn();
    const stack = [
      { path: '', name: 'System Map' },
      { path: 'apps', name: 'apps' },
      { path: 'apps/web', name: 'web' },
    ];
    render(<FloorPicker stack={stack} onJumpTo={onJumpTo} />);
    fireEvent.click(screen.getByText('apps'));
    expect(onJumpTo).toHaveBeenCalledWith(1);
  });

  it('renders exactly one slab for a single-entry stack (layer 0, nothing dived into yet)', () => {
    render(<FloorPicker stack={[{ path: '', name: 'System Map' }]} onJumpTo={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
