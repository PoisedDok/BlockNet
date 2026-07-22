import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { LayerArrow, LayerEdge } from '@blocknet/core';
import type { WebviewLayerItem } from '../../src/shared/protocol.js';
import { LayerCanvas } from '../src/flow/LayerCanvas.js';

function fileItem(id: string, opts: { dirty?: boolean; risk?: boolean } = {}): WebviewLayerItem {
  return { kind: 'file', id, name: id, path: `apps/web/${id}`, loc: 10, dirty: opts.dirty ?? false, risk: opts.risk ?? false };
}

function folderItem(id: string, opts: { dirty?: boolean; riskCount?: number; pills?: string[] } = {}): WebviewLayerItem {
  // Realistic name/path split (name is the basename, path is the full id) — matching how
  // analyze-layer.ts actually populates these fields. Setting name === path === id (as an
  // earlier draft of this helper did) makes BlockCard render the same text twice (once as the
  // name, once as the path row), which breaks getByText('apps/web') with a "found multiple
  // elements" ambiguity that has nothing to do with what each test actually checks.
  const name = id.split('/').at(-1) ?? id;
  return {
    kind: 'folder',
    id,
    name,
    path: id,
    isBlock: true,
    pills: opts.pills ?? [],
    fileCount: 3,
    riskCount: opts.riskCount ?? 0,
    dirty: opts.dirty ?? false,
  };
}

function edge(id: string, source: string, target: string, risk = false): LayerEdge {
  return { id, source, target, risk };
}

function docStackItem(id: string, files: string[], dirty = false): WebviewLayerItem {
  return { kind: 'docstack', id, files: files.map((path) => ({ path, name: path.split('/').at(-1) ?? path })), dirty };
}

function arrow(sourceItemId: string, targetFile: string, opts: { direction?: 'up' | 'down'; risk?: boolean } = {}): LayerArrow {
  return { id: `${sourceItemId}->${targetFile}`, sourceItemId, targetFile, direction: opts.direction ?? 'down', risk: opts.risk ?? false };
}

describe('LayerCanvas', () => {
  const postMessage = vi.fn();

  beforeAll(() => {
    globalThis.acquireVsCodeApi = vi.fn(() => ({ postMessage }));
  });

  beforeEach(() => {
    postMessage.mockClear();
  });

  it('renders both a folder item and a file item in the same layer', () => {
    const items = [folderItem('apps/web'), fileItem('package.json')];
    render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} />);
    expect(screen.getByText('apps/web')).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();
  });

  it('calls onDive with the item id when a folder card is double-clicked', () => {
    const onDive = vi.fn();
    const items = [folderItem('apps/web')];
    render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={onDive} />);
    const card = screen.getByText('apps/web').closest('.react-flow__node') as HTMLElement;
    fireEvent.doubleClick(card);
    expect(onDive).toHaveBeenCalledWith('apps/web');
  });

  it('never calls onDive when a file card is double-clicked (nothing to drill into)', () => {
    const onDive = vi.fn();
    const items = [fileItem('index.ts')];
    render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={onDive} />);
    const card = screen.getByText('index.ts').closest('.react-flow__node') as HTMLElement;
    fireEvent.doubleClick(card);
    expect(onDive).not.toHaveBeenCalled();
  });

  it('counts risky items (a risky file, or a folder with riskCount > 0) in the status bar', () => {
    const items = [fileItem('a.ts', { risk: true }), fileItem('b.ts'), folderItem('apps/legacy', { riskCount: 2 })];
    render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} />);
    expect(screen.getByText('2 risks detected')).toBeInTheDocument();
  });

  it('shows the dirty marker only on items flagged dirty, for both file and folder kinds', () => {
    const items = [fileItem('a.ts', { dirty: true }), folderItem('apps/web', { dirty: false })];
    render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} />);
    const fileCard = screen.getByText('a.ts').closest('.bn-file-card') as HTMLElement;
    const folderCard = screen.getByText('apps/web').closest('.bn-card') as HTMLElement;
    expect(fileCard.querySelector('.bn-file-card-dirty')).not.toBeNull();
    expect(folderCard.querySelector('.bn-card-dirty')).toBeNull();
  });

  it('clicking a file\'s ⤢ button posts open/file with the file id', () => {
    const items = [fileItem('a.ts')];
    render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /open a\.ts in editor/i }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'open/file', fileId: 'a.ts' });
  });

  it('renders one risk badge ("!") per risky edge', () => {
    const items = [folderItem('apps/web'), folderItem('apps/api'), folderItem('apps/db')];
    const edges = [edge('e1', 'apps/web', 'apps/api', true), edge('e2', 'apps/api', 'apps/db')];
    render(<LayerCanvas layerPath="" items={items} edges={edges} onDive={() => {}} />);
    expect(screen.getAllByText('!')).toHaveLength(1);
  });

  describe('doc-stack card', () => {
    it('renders a doc-stack item alongside folders and files in the same layer', () => {
      const items = [folderItem('apps/web'), fileItem('a.ts'), docStackItem('(docstack)', ['README.md', 'CONTRIBUTING.md'])];
      render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} />);
      expect(screen.getByText('apps/web')).toBeInTheDocument();
      expect(screen.getByText('a.ts')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('docs')).toBeInTheDocument();
    });

    it('selecting a doc-stack card opens its popover, listing its own files', () => {
      const items = [docStackItem('(docstack)', ['README.md', 'CONTRIBUTING.md'])];
      render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('docs'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('README.md')).toBeInTheDocument();
      expect(screen.getByText('CONTRIBUTING.md')).toBeInTheDocument();
    });

    it('closing the doc-stack popover clears the selection, so re-clicking reopens it', () => {
      const items = [docStackItem('(docstack)', ['README.md', 'CONTRIBUTING.md'])];
      render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} />);
      fireEvent.click(screen.getByText('docs'));
      fireEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('docs'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('double-clicking a doc-stack card never dives (there is no deeper layer to show)', () => {
      const onDive = vi.fn();
      const items = [docStackItem('(docstack)', ['README.md', 'CONTRIBUTING.md'])];
      render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={onDive} />);
      fireEvent.doubleClick(screen.getByText('docs'));
      expect(onDive).not.toHaveBeenCalled();
    });

    it('a doc-stack card position persists via onPositionChange, the same as any other item', () => {
      const onPositionChange = vi.fn();
      const items = [docStackItem('(docstack)', ['README.md', 'CONTRIBUTING.md'])];
      render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} onPositionChange={onPositionChange} />);
      const nodeEl = screen.getByText('docs').closest('.react-flow__node') as HTMLElement;
      fireEvent.click(nodeEl);
      fireEvent.keyDown(nodeEl, { key: 'ArrowRight' });
      expect(onPositionChange).toHaveBeenCalledWith('(docstack)', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    });
  });

  describe('inter-layer arrows', () => {
    it('attaches a folder item\'s own arrows to its node, not to an unrelated one', () => {
      const items = [folderItem('apps/web'), folderItem('apps/api')];
      const arrows = [arrow('apps/web', 'services/legacy/old.ts')];
      render(<LayerCanvas layerPath="" items={items} edges={[]} arrows={arrows} onDive={() => {}} />);
      const webNode = screen.getByText('apps/web').closest('.react-flow__node') as HTMLElement;
      const apiNode = screen.getByText('apps/api').closest('.react-flow__node') as HTMLElement;
      expect(webNode.querySelector('.bn-inter-layer-arrow')).not.toBeNull();
      expect(apiNode.querySelector('.bn-inter-layer-arrow')).toBeNull();
    });

    it('attaches a file item\'s own arrows to its node the same way', () => {
      const items = [fileItem('a.ts')];
      const arrows = [arrow('a.ts', 'services/legacy/old.ts')];
      render(<LayerCanvas layerPath="" items={items} edges={[]} arrows={arrows} onDive={() => {}} />);
      expect(screen.getByText('old.ts')).toBeInTheDocument();
    });

    it('renders no arrow row at all when an item has none', () => {
      const items = [folderItem('apps/web')];
      render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} />);
      expect(document.querySelector('.bn-inter-layer-arrow')).toBeNull();
    });

    it('calls onArrowNavigate with the target file when an arrow is clicked', () => {
      const onArrowNavigate = vi.fn();
      const items = [folderItem('apps/web')];
      const arrows = [arrow('apps/web', 'services/legacy/old.ts')];
      render(<LayerCanvas layerPath="" items={items} edges={[]} arrows={arrows} onDive={() => {}} onArrowNavigate={onArrowNavigate} />);
      fireEvent.click(screen.getByText('old.ts'));
      expect(onArrowNavigate).toHaveBeenCalledWith('services/legacy/old.ts');
    });

    it('clicking an arrow never also triggers the card\'s own double-click-to-dive', () => {
      const onDive = vi.fn();
      const items = [folderItem('apps/web')];
      const arrows = [arrow('apps/web', 'services/legacy/old.ts')];
      render(<LayerCanvas layerPath="" items={items} edges={[]} arrows={arrows} onDive={onDive} onArrowNavigate={() => {}} />);
      fireEvent.doubleClick(screen.getByText('old.ts'));
      expect(onDive).not.toHaveBeenCalled();
    });
  });

  describe('drag persistence', () => {
    it('moves a folder card position via onPositionChange and keeps it across a live prop update', () => {
      const onPositionChange = vi.fn();
      const items = [folderItem('apps/web'), folderItem('apps/api')];
      const { rerender } = render(
        <LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} onPositionChange={onPositionChange} />,
      );
      const nodeEl = () => screen.getByText('apps/web').closest('.react-flow__node') as HTMLElement;
      const before = nodeEl().style.transform;

      fireEvent.click(nodeEl());
      fireEvent.keyDown(nodeEl(), { key: 'ArrowRight' });
      const afterMove = nodeEl().style.transform;

      expect(afterMove).not.toBe(before);
      expect(onPositionChange).toHaveBeenCalledWith('apps/web', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));

      rerender(
        <LayerCanvas
          layerPath=""
         
          items={[folderItem('apps/web'), folderItem('apps/api')]}
          edges={[]}
          onDive={() => {}}
          onPositionChange={onPositionChange}
        />,
      );
      expect(nodeEl().style.transform).toBe(afterMove);
    });

    it('moves a file card position the same way', () => {
      const onPositionChange = vi.fn();
      const items = [fileItem('a.ts'), fileItem('b.ts')];
      render(<LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} onPositionChange={onPositionChange} />);
      const nodeEl = screen.getByText('a.ts').closest('.react-flow__node') as HTMLElement;
      fireEvent.click(nodeEl);
      fireEvent.keyDown(nodeEl, { key: 'ArrowRight' });
      expect(onPositionChange).toHaveBeenCalledWith('a.ts', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    });

    it('seeds a folder card from initialPositions when supplied', () => {
      const items = [folderItem('apps/web')];
      render(
        <LayerCanvas layerPath="" items={items} edges={[]} onDive={() => {}} initialPositions={{ 'apps/web': { x: 777, y: 888 } }} />,
      );
      const nodeEl = screen.getByText('apps/web').closest('.react-flow__node') as HTMLElement;
      expect(nodeEl.style.transform).toContain('777px');
      expect(nodeEl.style.transform).toContain('888px');
    });

    it('renders the draggable "grab the line" affordance on a layer edge when onWaypointsChange is supplied', () => {
      const items = [folderItem('apps/web'), folderItem('apps/api')];
      const edges = [edge('e1', 'apps/web', 'apps/api')];
      const { container } = render(
        <LayerCanvas layerPath="" items={items} edges={edges} onDive={() => {}} onWaypointsChange={() => {}} />,
      );
      expect(container.querySelector('.bn-edge-grab')).not.toBeNull();
    });

    it('renders no grab affordance when onWaypointsChange is not supplied', () => {
      const items = [folderItem('apps/web'), folderItem('apps/api')];
      const edges = [edge('e1', 'apps/web', 'apps/api')];
      const { container } = render(<LayerCanvas layerPath="" items={items} edges={edges} onDive={() => {}} />);
      expect(container.querySelector('.bn-edge-grab')).toBeNull();
    });

    it('renders a waypoint handle for an existing waypoint passed via initialEdgeWaypoints', () => {
      const items = [folderItem('apps/web'), folderItem('apps/api')];
      const edges = [edge('e1', 'apps/web', 'apps/api')];
      const { container } = render(
        <LayerCanvas
          layerPath=""
         
          items={items}
          edges={edges}
          onDive={() => {}}
          onWaypointsChange={() => {}}
          initialEdgeWaypoints={{ e1: [{ x: 100, y: 60 }] }}
        />,
      );
      expect(container.querySelector('.bn-edge-waypoint-handle')).not.toBeNull();
    });
  });
});
