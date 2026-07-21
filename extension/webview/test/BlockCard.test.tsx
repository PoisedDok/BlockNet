import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockCard } from '../src/flow/BlockCard.js';

const baseProps = {
  name: 'gateway',
  path: 'services/gateway',
  pills: ['express', 'zod'],
  riskCount: 0,
  connectionCount: 3,
  selected: false,
  dimmed: false,
};

describe('BlockCard', () => {
  it('renders the block name and path', () => {
    render(<BlockCard {...baseProps} />);
    expect(screen.getByText('gateway')).toBeInTheDocument();
    expect(screen.getByText('services/gateway')).toBeInTheDocument();
  });

  it('renders every tech pill', () => {
    render(<BlockCard {...baseProps} />);
    expect(screen.getByText('express')).toBeInTheDocument();
    expect(screen.getByText('zod')).toBeInTheDocument();
  });

  it('shows the connection count', () => {
    render(<BlockCard {...baseProps} connectionCount={5} />);
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('does not render a risk pill when riskCount is 0', () => {
    render(<BlockCard {...baseProps} riskCount={0} />);
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
  });

  it('renders a risk pill with the exact count when riskCount > 0', () => {
    render(<BlockCard {...baseProps} riskCount={2} />);
    expect(screen.getByText('2× ⚠')).toBeInTheDocument();
  });

  it('exposes an accessible name that includes the block name and path', () => {
    render(<BlockCard {...baseProps} />);
    const card = screen.getByRole('button', { name: /gateway/ });
    expect(card).toHaveAccessibleName(expect.stringContaining('services/gateway'));
  });

  it('is keyboard-activatable (Enter/Space) and calls onSelect', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<BlockCard {...baseProps} onSelect={onSelect} />);
    const card = screen.getByRole('button', { name: /gateway/ });
    card.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('mentions the risk count in its accessible name when at risk', () => {
    render(<BlockCard {...baseProps} riskCount={1} />);
    expect(screen.getByRole('button', { name: /1 risk/i })).toBeInTheDocument();
  });
});
