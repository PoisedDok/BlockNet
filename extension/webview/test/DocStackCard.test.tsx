import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DocStackCard } from '../src/flow/DocStackCard.js';

describe('DocStackCard', () => {
  it('shows the file count', () => {
    render(<DocStackCard count={3} selected={false} dimmed={false} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
  });

  it('is compact (not data-large) at 2-3 files', () => {
    render(<DocStackCard count={3} selected={false} dimmed={false} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('data-large');
  });

  it('is data-large for more than 3 files, sized like a folder-block card', () => {
    render(<DocStackCard count={4} selected={false} dimmed={false} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-large', 'true');
  });

  it('marks itself data-selected when selected', () => {
    render(<DocStackCard count={2} selected={true} dimmed={false} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-selected', 'true');
  });

  it('dims via opacity when dimmed', () => {
    render(<DocStackCard count={2} selected={false} dimmed={true} />);
    expect(screen.getByRole('button')).toHaveStyle({ opacity: '0.14' });
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(<DocStackCard count={2} selected={false} dimmed={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect on Enter key', () => {
    const onSelect = vi.fn();
    render(<DocStackCard count={2} selected={false} dimmed={false} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders no interactive semantics when interactive is false (mounted inside an RF node)', () => {
    render(<DocStackCard count={2} selected={false} dimmed={false} interactive={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('exposes an accessible label with the file count when interactive', () => {
    render(<DocStackCard count={5} selected={false} dimmed={false} />);
    expect(screen.getByRole('button', { name: '5 documentation files' })).toBeInTheDocument();
  });
});
