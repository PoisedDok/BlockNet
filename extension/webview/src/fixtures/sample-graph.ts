import type { Edge, MicroFileEdge, Risk } from '@blocknet/core';
import type { WebviewBlockNode, WebviewMicroFileNode } from '../../../src/shared/protocol.js';

// Static fixture data for Task 7 (docs/planning/TASKS-V1.md) — live graph.macro/risks.update
// data replaces this in Task 8. Shapes mirror a small real monorepo closely enough to
// exercise every visual state at once: a genuine import cycle (CIRCULAR), a deep-import
// boundary violation (BOUNDARY), and a normal, risk-free edge.

const circularRisk: Risk = {
  tag: 'CIRCULAR',
  oneLine: 'gateway and auth import each other, forming a cycle',
  explain: "services/gateway imports services/auth's verify(), and services/auth imports back services/gateway's route types — neither can be built or reasoned about independently.",
  fix: 'Extract the shared contract (route types + verify signature) into a third package both depend on.',
  source: 'services/gateway',
  target: 'services/auth',
  evidence: [{ file: 'services/gateway/src/middleware/guard.ts', line: 1, statement: "import { verify } from '../../auth/src'" }],
};

const boundaryRisk: Risk = {
  tag: 'BOUNDARY',
  oneLine: 'apps/web imports a deep internal path of packages/db instead of its declared entry',
  explain: "apps/web/lib/data.ts imports packages/db/src/internal/pool.ts directly, bypassing packages/db's declared package.json entry.",
  fix: "Import packages/db's public entry point instead, or export pool from it if that surface is meant to be public.",
  source: 'apps/web',
  target: 'packages/db',
  evidence: [{ file: 'apps/web/lib/data.ts', line: 3, statement: "import { pool } from '../../../packages/db/src/internal/pool'" }],
};

export const sampleNodes: WebviewBlockNode[] = [
  { id: 'services/gateway', name: 'gateway', path: 'services/gateway', pills: ['express', 'zod'], fileCount: 18, riskCount: 1, dirty: false },
  { id: 'services/auth', name: 'auth', path: 'services/auth', pills: ['jsonwebtoken', 'bcrypt'], fileCount: 12, riskCount: 1, dirty: false },
  { id: 'apps/web', name: 'web', path: 'apps/web', pills: ['react', 'next'], fileCount: 47, riskCount: 1, dirty: true },
  { id: 'packages/db', name: 'db', path: 'packages/db', pills: ['pg', 'drizzle-orm'], fileCount: 9, riskCount: 0, dirty: false },
  { id: 'packages/ui', name: 'ui', path: 'packages/ui', pills: ['react', 'radix-ui'], fileCount: 31, riskCount: 0, dirty: false },
];

export const sampleEdges: Edge[] = [
  { id: 'gateway-auth', source: 'services/gateway', target: 'services/auth', importCount: 3, risk: circularRisk },
  { id: 'auth-gateway', source: 'services/auth', target: 'services/gateway', importCount: 1, risk: circularRisk },
  { id: 'web-ui', source: 'apps/web', target: 'packages/ui', importCount: 22 },
  { id: 'web-db', source: 'apps/web', target: 'packages/db', importCount: 2, risk: boundaryRisk },
  { id: 'ui-db', source: 'packages/ui', target: 'packages/db', importCount: 1 },
];

// v2.0 micro view (docs/planning/ROADMAP-V2.md) dev/QA fixture — one block (services/gateway)
// exercises a real intra-block cycle (guard.ts <-> auth-client.ts, the exact "deliberate v1
// scope boundary" analyze-micro.ts's header comment describes closing), apps/web exercises a
// dirty marker on the file that made the real BOUNDARY import, and packages/ui is a plain,
// risk-free block with no intra-block edges at all — three distinct visual states in one
// static dataset, mirroring sample-graph.ts's own "exercise every state at once" design.
function microFile(id: string, loc: number, opts: { dirty?: boolean; risk?: boolean } = {}): WebviewMicroFileNode {
  const name = id.split('/').at(-1) ?? id;
  return { id, name, path: id, loc, dirty: opts.dirty ?? false, risk: opts.risk ?? false };
}

function microEdge(source: string, target: string, risk = false): MicroFileEdge {
  return { id: `${source}->${target}`, source, target, risk };
}

export const sampleMicroByBlock: Record<string, { files: WebviewMicroFileNode[]; edges: MicroFileEdge[] }> = {
  'services/gateway': {
    files: [
      microFile('services/gateway/src/index.ts', 12),
      microFile('services/gateway/src/middleware/guard.ts', 48, { risk: true }),
      microFile('services/gateway/src/middleware/auth-client.ts', 31, { risk: true }),
      microFile('services/gateway/src/routes.ts', 96),
    ],
    edges: [
      microEdge('services/gateway/src/index.ts', 'services/gateway/src/routes.ts'),
      microEdge('services/gateway/src/middleware/guard.ts', 'services/gateway/src/middleware/auth-client.ts', true),
      microEdge('services/gateway/src/middleware/auth-client.ts', 'services/gateway/src/middleware/guard.ts', true),
    ],
  },
  'services/auth': {
    files: [microFile('services/auth/src/index.ts', 20), microFile('services/auth/src/verify.ts', 64)],
    edges: [microEdge('services/auth/src/index.ts', 'services/auth/src/verify.ts')],
  },
  'apps/web': {
    files: [
      microFile('apps/web/lib/data.ts', 58, { dirty: true, risk: true }),
      microFile('apps/web/lib/format.ts', 27),
      microFile('apps/web/app/page.tsx', 41),
    ],
    edges: [microEdge('apps/web/app/page.tsx', 'apps/web/lib/data.ts'), microEdge('apps/web/lib/data.ts', 'apps/web/lib/format.ts')],
  },
  'packages/db': {
    files: [microFile('packages/db/src/index.ts', 8), microFile('packages/db/src/internal/pool.ts', 73)],
    edges: [microEdge('packages/db/src/index.ts', 'packages/db/src/internal/pool.ts')],
  },
  'packages/ui': {
    files: [microFile('packages/ui/src/Button.tsx', 45), microFile('packages/ui/src/Card.tsx', 39)],
    edges: [],
  },
};
