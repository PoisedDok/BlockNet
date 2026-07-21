import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Risk } from '@blocknet/core';
import { RiskPopover } from '../src/ui/RiskPopover.js';

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    tag: 'CIRCULAR',
    oneLine: 'gateway and auth import each other',
    explain: 'A cycle between two blocks makes them impossible to release independently.',
    fix: 'Extract the shared dependency into a third block.',
    source: 'gateway',
    target: 'auth',
    evidence: [{ file: 'src/gateway/index.ts', line: 12, statement: "import { login } from '../auth';" }],
    ...overrides,
  };
}

describe('RiskPopover', () => {
  const postMessage = vi.fn();

  beforeAll(() => {
    globalThis.acquireVsCodeApi = vi.fn(() => ({ postMessage }));
  });

  beforeEach(() => {
    postMessage.mockClear();
  });

  it('renders the risk tag, oneLine, explain, and fix text', () => {
    render(<RiskPopover risk={risk()} onClose={() => {}} />);
    expect(screen.getByText('CIRCULAR')).toBeInTheDocument();
    expect(screen.getByText('gateway and auth import each other')).toBeInTheDocument();
    expect(screen.getByText(/impossible to release independently/)).toBeInTheDocument();
    expect(screen.getByText(/Extract the shared dependency/)).toBeInTheDocument();
  });

  it('renders every evidence entry as a file:line with its import statement', () => {
    render(
      <RiskPopover
        risk={risk({
          evidence: [
            { file: 'src/gateway/index.ts', line: 12, statement: "import { login } from '../auth';" },
            { file: 'src/gateway/router.ts', line: 4, statement: "import auth from '../auth/index.js';" },
          ],
        })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('src/gateway/index.ts:12')).toBeInTheDocument();
    expect(screen.getByText("import { login } from '../auth';")).toBeInTheDocument();
    expect(screen.getByText('src/gateway/router.ts:4')).toBeInTheDocument();
    expect(screen.getByText("import auth from '../auth/index.js';")).toBeInTheDocument();
  });

  it('posts open/file with the evidence file and line when an evidence entry is clicked', () => {
    render(<RiskPopover risk={risk()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /src\/gateway\/index\.ts:12/ }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'open/file', fileId: 'src/gateway/index.ts', line: 12 });
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<RiskPopover risk={risk()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<RiskPopover risk={risk()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible dialog labelled with the risk one-liner', () => {
    render(<RiskPopover risk={risk()} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'gateway and auth import each other' })).toBeInTheDocument();
  });
});
