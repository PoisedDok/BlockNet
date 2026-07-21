import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileCard } from '../src/flow/FileCard.js';

const baseProps = {
  name: 'index.ts',
  path: 'packages/a/src/index.ts',
  loc: 42,
  dirty: false,
  risk: false,
  selected: false,
  dimmed: false,
};

describe('FileCard', () => {
  it('renders the file name, path, and LOC', () => {
    render(<FileCard {...baseProps} />);
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('packages/a/src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('42 LOC')).toBeInTheDocument();
  });

  it('does not render the risk pill when risk is false', () => {
    render(<FileCard {...baseProps} risk={false} />);
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
  });

  it('renders the ⚠ risk pill when risk is true', () => {
    render(<FileCard {...baseProps} risk={true} />);
    expect(screen.getByText('⚠ risk')).toBeInTheDocument();
  });

  it('does not render the dirty marker when dirty is false', () => {
    render(<FileCard {...baseProps} dirty={false} />);
    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
  });

  it('renders the ● edited marker when dirty is true', () => {
    render(<FileCard {...baseProps} dirty={true} />);
    expect(screen.getByText(/edited/)).toBeInTheDocument();
  });

  it('is keyboard-activatable (Enter/Space) and calls onSelect', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<FileCard {...baseProps} onSelect={onSelect} />);
    const card = screen.getByRole('button', { name: /^index\.ts,/ });
    card.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('clicking the ⤢ button calls onOpenInEditor without also triggering onSelect', async () => {
    const onSelect = vi.fn();
    const onOpenInEditor = vi.fn();
    const user = userEvent.setup();
    render(<FileCard {...baseProps} onSelect={onSelect} onOpenInEditor={onOpenInEditor} />);
    await user.click(screen.getByRole('button', { name: /open index\.ts in editor/i }));
    expect(onOpenInEditor).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('exposes an accessible name that includes the file name and path', () => {
    render(<FileCard {...baseProps} />);
    const card = screen.getByRole('button', { name: /^index\.ts,/ });
    expect(card).toHaveAccessibleName(expect.stringContaining('packages/a/src/index.ts'));
  });

  it('renders no outer interactive role/tabIndex when interactive is false', () => {
    render(<FileCard {...baseProps} interactive={false} />);
    expect(screen.queryByRole('button', { name: /^index\.ts,/ })).not.toBeInTheDocument();
    // The ⤢ open-in-editor button is still real and present even when the outer card isn't
    // interactive — it's rendered by FileNode.tsx inside React Flow's own node wrapper, which
    // owns the outer click/keyboard handling instead (mirrors BlockCard's interactive={false}
    // posture, extended here for FileCard's one nested real interactive element).
    expect(screen.getByRole('button', { name: /open .* in editor/i })).toBeInTheDocument();
  });
});
