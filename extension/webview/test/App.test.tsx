import { act, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage } from '../../src/shared/protocol.js';
import { App } from '../src/App.js';

function postFromHost(message: HostMessage) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
}

describe('App', () => {
  const postMessage = vi.fn();

  beforeAll(() => {
    globalThis.acquireVsCodeApi = vi.fn(() => ({ postMessage }));
  });

  beforeEach(() => {
    postMessage.mockClear();
  });

  it('posts webview/ready on mount, echoing the generation meta tag (empty string if absent, as in this test DOM)', () => {
    render(<App />);
    expect(postMessage).toHaveBeenCalledWith({ type: 'webview/ready', generation: '' });
  });

  it('echoes the real generation id when panel.ts injected a <meta name="blocknet-generation"> tag', () => {
    // panel.ts's whenReady() matches on this value (PROTOCOL.md's ready-handshake) to tell a
    // stale ready apart from the one it's actually waiting for — this only closes that race if
    // the webview actually echoes back what the host minted, not a hardcoded/empty value.
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'blocknet-generation');
    meta.setAttribute('content', 'gen-xyz-789');
    document.head.appendChild(meta);
    render(<App />);
    expect(postMessage).toHaveBeenCalledWith({ type: 'webview/ready', generation: 'gen-xyz-789' });
    meta.remove();
  });

  it('shows a loading state before the first graph/macro arrives', () => {
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent(/Analyzing/i);
  });

  it('reflects analysis/progress phase/done/total while waiting', () => {
    render(<App />);
    postFromHost({ type: 'analysis/progress', phase: 'edges', done: 2, total: 5 });
    expect(screen.getByRole('status')).toHaveTextContent(/edges/i);
    expect(screen.getByRole('status')).toHaveTextContent('2');
    expect(screen.getByRole('status')).toHaveTextContent('5');
  });

  it('renders the real graph once graph/macro arrives', () => {
    render(<App />);
    postFromHost({
      type: 'graph/macro',
      nodes: [{ id: 'gateway', name: 'gateway', path: 'packages/gateway', pills: [], fileCount: 1, riskCount: 0, dirty: false }],
      edges: [],
    });
    expect(screen.getByText('gateway')).toBeInTheDocument();
    expect(screen.queryByText(/Analyzing/i)).not.toBeInTheDocument();
  });
});
