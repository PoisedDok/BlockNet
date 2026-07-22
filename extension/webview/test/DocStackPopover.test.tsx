import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { LayerDocFile } from '@blocknet/core';
import { DocStackPopover } from '../src/ui/DocStackPopover.js';

function files(): LayerDocFile[] {
  return [
    { path: 'docs/architecture.md', name: 'architecture.md' },
    { path: 'docs/decisions.md', name: 'decisions.md' },
  ];
}

describe('DocStackPopover', () => {
  const postMessage = vi.fn();

  beforeAll(() => {
    globalThis.acquireVsCodeApi = vi.fn(() => ({ postMessage }));
  });

  beforeEach(() => {
    postMessage.mockClear();
  });

  it('renders every file by name', () => {
    render(<DocStackPopover files={files()} onClose={() => {}} />);
    expect(screen.getByText('architecture.md')).toBeInTheDocument();
    expect(screen.getByText('decisions.md')).toBeInTheDocument();
  });

  it('posts open/file with the file\'s own path (not display name) when a row is clicked', () => {
    render(<DocStackPopover files={files()} onClose={() => {}} />);
    fireEvent.click(screen.getByText('architecture.md'));
    expect(postMessage).toHaveBeenCalledWith({ type: 'open/file', fileId: 'docs/architecture.md' });
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<DocStackPopover files={files()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<DocStackPopover files={files()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible dialog labelled with the file count', () => {
    render(<DocStackPopover files={files()} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: '2 documentation files' })).toBeInTheDocument();
  });

  it('uses singular phrasing for exactly one file', () => {
    render(<DocStackPopover files={[files()[0] as LayerDocFile]} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: '1 documentation file' })).toBeInTheDocument();
  });
});
