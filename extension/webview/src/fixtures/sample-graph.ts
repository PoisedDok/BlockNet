import type { LayerEdge } from '@blocknet/core';
import type { WebviewLayerItem } from '../../../src/shared/protocol.js';
import type { LayerPayload } from '../flow/GraphView.js';

// Static fixture data (docs/planning/TASKS-V1.md's Task 7, generalized to the v2.0.1 unified
// layer model, docs/planning/ROADMAP-V2.md) — live graph/layer data replaces this in a real
// VS Code host. Shapes mirror a small real monorepo closely enough to exercise every visual
// state at once: a genuine import cycle (CIRCULAR), a boundary-style crossing, a normal
// risk-free edge, a loose root file NOT wrapped in any block (the unified model's own
// decided behavior), and an intra-block cycle one layer deeper.

function folder(id: string, name: string, opts: { pills?: string[]; fileCount?: number; riskCount?: number; dirty?: boolean } = {}): WebviewLayerItem {
  return {
    kind: 'folder',
    id,
    name,
    path: id,
    isBlock: true,
    pills: opts.pills ?? [],
    fileCount: opts.fileCount ?? 1,
    riskCount: opts.riskCount ?? 0,
    dirty: opts.dirty ?? false,
  };
}

function file(id: string, loc: number, opts: { dirty?: boolean; risk?: boolean } = {}): WebviewLayerItem {
  const name = id.split('/').at(-1) ?? id;
  return { kind: 'file', id, name, path: id, loc, dirty: opts.dirty ?? false, risk: opts.risk ?? false };
}

function edge(source: string, target: string, risk = false): LayerEdge {
  return { id: `${source}->${target}`, source, target, risk };
}

export const sampleLayers: Record<string, LayerPayload> = {
  '': {
    layerPath: '',
    items: [
      folder('services/gateway', 'gateway', { pills: ['express', 'zod'], fileCount: 18, riskCount: 1 }),
      folder('services/auth', 'auth', { pills: ['jsonwebtoken', 'bcrypt'], fileCount: 12, riskCount: 1 }),
      folder('apps/web', 'web', { pills: ['react', 'next'], fileCount: 47, riskCount: 1, dirty: true }),
      folder('packages/db', 'db', { pills: ['pg', 'drizzle-orm'], fileCount: 9 }),
      folder('packages/ui', 'ui', { pills: ['react', 'radix-ui'], fileCount: 31 }),
      file('README.md', 4),
    ],
    edges: [
      edge('services/gateway', 'services/auth', true),
      edge('services/auth', 'services/gateway', true),
      edge('apps/web', 'packages/ui'),
      edge('apps/web', 'packages/db', true),
      edge('packages/ui', 'packages/db'),
    ],
    arrows: [],
  },
  'services/gateway': {
    layerPath: 'services/gateway',
    items: [
      file('services/gateway/index.ts', 12),
      file('services/gateway/guard.ts', 48, { risk: true }),
      file('services/gateway/auth-client.ts', 31, { risk: true }),
      file('services/gateway/routes.ts', 96),
    ],
    edges: [
      edge('services/gateway/index.ts', 'services/gateway/routes.ts'),
      edge('services/gateway/guard.ts', 'services/gateway/auth-client.ts', true),
      edge('services/gateway/auth-client.ts', 'services/gateway/guard.ts', true),
    ],
    arrows: [],
  },
  'services/auth': {
    layerPath: 'services/auth',
    items: [file('services/auth/index.ts', 20), file('services/auth/verify.ts', 64)],
    edges: [edge('services/auth/index.ts', 'services/auth/verify.ts')],
    arrows: [],
  },
  'apps/web': {
    layerPath: 'apps/web',
    items: [file('apps/web/data.ts', 58, { dirty: true, risk: true }), file('apps/web/format.ts', 27), file('apps/web/page.tsx', 41)],
    edges: [edge('apps/web/page.tsx', 'apps/web/data.ts'), edge('apps/web/data.ts', 'apps/web/format.ts')],
    arrows: [],
  },
  'packages/db': {
    layerPath: 'packages/db',
    items: [file('packages/db/index.ts', 8), file('packages/db/pool.ts', 73)],
    edges: [edge('packages/db/index.ts', 'packages/db/pool.ts')],
    arrows: [],
  },
  'packages/ui': {
    layerPath: 'packages/ui',
    items: [file('packages/ui/Button.tsx', 45), file('packages/ui/Card.tsx', 39)],
    edges: [],
    arrows: [],
  },
};
