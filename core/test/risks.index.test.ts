import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runRiskChecks } from '../src/risks/index.js';
import type { BlockNode, Edge, FileEdge } from '../src/types.js';

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-risks-index-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function writeText(path: string, contents: string) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

function writeJson(path: string, value: unknown) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function block(path: string, name = path): BlockNode {
  return { id: path, name, path, pills: [], fileCount: 0, riskCount: 0 };
}

function fileEdge(sourceFile: string, targetFile: string, line = 1): FileEdge {
  return { sourceFile, targetFile, line, statement: `import from '${targetFile}'` };
}

function blockEdge(source: string, target: string, importCount = 1): Edge {
  return { id: `${source}->${target}`, source, target, importCount };
}

describe('runRiskChecks — pure circular case', () => {
  it('flags both directions of a 2-block mutual cycle, attaches CIRCULAR to both Edges', () => {
    const root = createTempRepo();
    writeText(resolve(root, 'p/index.ts'), 'export {};\n');
    writeText(resolve(root, 'q/index.ts'), 'export {};\n');
    const blocks = [block('p'), block('q')];
    const fileEdges = [fileEdge('p/index.ts', 'q/index.ts'), fileEdge('q/index.ts', 'p/index.ts')];
    const edges = [blockEdge('p', 'q'), blockEdge('q', 'p')];

    const result = runRiskChecks(fileEdges, blocks, edges, root);

    expect(result.risks).toHaveLength(2);
    expect(result.risks.every((r) => r.tag === 'CIRCULAR')).toBe(true);
    const pq = result.edges.find((e) => e.id === 'p->q');
    const qp = result.edges.find((e) => e.id === 'q->p');
    expect(pq?.risk?.tag).toBe('CIRCULAR');
    expect(qp?.risk?.tag).toBe('CIRCULAR');
    expect(pq?.risk?.fix).toBe('Extract the shared contract into a third package.');
    expect(pq?.risk?.evidence).toEqual([{ file: 'p/index.ts', line: 1, statement: "import from 'q/index.ts'" }]);
  });
});

describe('runRiskChecks — pure boundary case', () => {
  it('flags a one-way deep import as BOUNDARY, not CIRCULAR', () => {
    const root = createTempRepo();
    writeText(resolve(root, 'p/index.ts'), 'export {};\n');
    writeJson(resolve(root, 'q/package.json'), { name: 'q' });
    writeText(resolve(root, 'q/index.ts'), 'export {};\n');
    writeText(resolve(root, 'q/internal.ts'), 'export {};\n');
    const blocks = [block('p'), block('q')];
    const fileEdges = [fileEdge('p/index.ts', 'q/internal.ts')];
    const edges = [blockEdge('p', 'q')];

    const result = runRiskChecks(fileEdges, blocks, edges, root);

    expect(result.risks).toHaveLength(1);
    expect(result.risks[0]).toMatchObject({ tag: 'BOUNDARY', source: 'p', target: 'q' });
    expect(result.edges.find((e) => e.id === 'p->q')?.risk?.tag).toBe('BOUNDARY');
  });
});

describe('runRiskChecks — both tags on the SAME directed block pair', () => {
  it('keeps both Risk objects in the full risks[] list, but CIRCULAR wins the single Edge.risk slot', () => {
    const root = createTempRepo();
    writeText(resolve(root, 'p/a.ts'), 'export {};\n');
    writeText(resolve(root, 'p/b.ts'), 'export {};\n');
    writeText(resolve(root, 'p/index.ts'), 'export {};\n');
    writeJson(resolve(root, 'q/package.json'), { name: 'q' });
    writeText(resolve(root, 'q/index.ts'), 'export {};\n');
    writeText(resolve(root, 'q/deep.ts'), 'export {};\n');
    const blocks = [block('p'), block('q')];
    const fileEdges = [
      fileEdge('p/a.ts', 'q/deep.ts'), // boundary violation, not cyclic
      fileEdge('p/b.ts', 'q/index.ts'), // cyclic, crosses p->q, entry import — not boundary
      fileEdge('q/index.ts', 'p/index.ts'), // cyclic, crosses q->p, entry import — not boundary
      fileEdge('p/index.ts', 'p/b.ts'), // closes the cycle, but intra-block — not a block Edge at all
    ];
    const edges = [blockEdge('p', 'q', 2), blockEdge('q', 'p', 1)];

    const result = runRiskChecks(fileEdges, blocks, edges, root);

    const pqRisks = result.risks.filter((r) => r.source === 'p' && r.target === 'q');
    expect(pqRisks.map((r) => r.tag).sort()).toEqual(['BOUNDARY', 'CIRCULAR']);
    expect(result.risks).toHaveLength(3); // p->q CIRCULAR, p->q BOUNDARY, q->p CIRCULAR

    expect(result.edges.find((e) => e.id === 'p->q')?.risk?.tag).toBe('CIRCULAR');
    expect(result.edges.find((e) => e.id === 'q->p')?.risk?.tag).toBe('CIRCULAR');
  });
});

describe('runRiskChecks — clean graph', () => {
  it('returns no risks and leaves every Edge.risk undefined when nothing is wrong', () => {
    const root = createTempRepo();
    writeText(resolve(root, 'p/index.ts'), 'export {};\n');
    writeText(resolve(root, 'q/index.ts'), 'export {};\n');
    const blocks = [block('p'), block('q')];
    const fileEdges = [fileEdge('p/index.ts', 'q/index.ts')];
    const edges = [blockEdge('p', 'q')];

    const result = runRiskChecks(fileEdges, blocks, edges, root);

    expect(result.risks).toEqual([]);
    expect(result.edges).toEqual(edges);
    expect(result.edges[0]?.risk).toBeUndefined();
  });

  it('returns empty results for empty input', () => {
    const root = createTempRepo();
    const result = runRiskChecks([], [], [], root);
    expect(result.risks).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});
