import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it('requests layer 0 once graph/macro arrives, and renders it once that response lands', () => {
    // v2.0.1 unified layer model (docs/planning/ROADMAP-V2.md): graph/macro's own payload is
    // no longer rendered directly — its arrival is just the signal to fetch layer 0, which is
    // what actually populates the mixed block/file/folder view.
    render(<App />);
    postFromHost({
      type: 'graph/macro',
      nodes: [{ id: 'gateway', name: 'gateway', path: 'packages/gateway', pills: [], fileCount: 1, riskCount: 0, dirty: false }],
      edges: [],
    });
    expect(postMessage).toHaveBeenCalledWith({ type: 'graph/layer/request', layerPath: '' });
    expect(screen.queryByText('gateway')).not.toBeInTheDocument();

    postFromHost({
      type: 'graph/layer',
      layerPath: '',
      items: [{ kind: 'folder', id: 'packages/gateway', name: 'gateway', path: 'packages/gateway', isBlock: true, pills: [], fileCount: 1, riskCount: 0, dirty: false }],
      edges: [],
      arrows: [],
    });
    expect(screen.getByText('gateway')).toBeInTheDocument();
    expect(screen.queryByText(/Analyzing/i)).not.toBeInTheDocument();
  });

  it('re-requests the CURRENT layer (not root) when a background re-analysis posts a fresh graph/macro', () => {
    // A save-triggered re-analysis while the user is several layers deep must refresh what
    // they're actually looking at, not silently snap them back to root — see App.tsx's own
    // comment on currentLayerPathRef and docs/architecture/FLOWS.md's flow 2.
    render(<App />);
    postFromHost({ type: 'graph/macro', nodes: [], edges: [] });
    postFromHost({
      type: 'graph/layer',
      layerPath: '',
      items: [{ kind: 'folder', id: 'packages', name: 'Packages Folder', path: 'packages', isBlock: false, pills: [], fileCount: 1, riskCount: 0, dirty: false }],
      edges: [],
      arrows: [],
    });
    postMessage.mockClear();

    // Dive into the folder — GraphView's navigateTo posts graph/layer/request synchronously,
    // which is when the current-layer ref this fix relies on gets updated.
    fireEvent.doubleClick(screen.getByText('Packages Folder'));
    expect(postMessage).toHaveBeenCalledWith({ type: 'graph/layer/request', layerPath: 'packages' });
    postMessage.mockClear();

    postFromHost({ type: 'graph/macro', nodes: [], edges: [] });
    expect(postMessage).toHaveBeenCalledWith({ type: 'graph/layer/request', layerPath: 'packages' });
  });
});
