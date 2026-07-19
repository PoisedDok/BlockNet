import { describe, expect, it } from 'vitest';
import { findCyclicFileEdges } from '../src/risks/cycles.js';
import type { FileEdge } from '../src/types.js';

function fileEdge(sourceFile: string, targetFile: string, line = 1): FileEdge {
  return { sourceFile, targetFile, line, statement: `import from '${targetFile}'` };
}

describe('findCyclicFileEdges', () => {
  it('flags exactly the edges inside a 3-file cycle, and nothing else', () => {
    const cyclic = [fileEdge('a.ts', 'b.ts'), fileEdge('b.ts', 'c.ts'), fileEdge('c.ts', 'a.ts')];
    const noise = fileEdge('a.ts', 'd.ts'); // one-way, not part of any cycle
    const edges = findCyclicFileEdges([...cyclic, noise]);

    expect(edges).toHaveLength(3);
    expect(edges).toEqual(expect.arrayContaining(cyclic));
    expect(edges).not.toEqual(expect.arrayContaining([noise]));
  });

  it('returns an empty array for a DAG with no cycles (a diamond shape)', () => {
    const edges = findCyclicFileEdges([
      fileEdge('a.ts', 'b.ts'),
      fileEdge('a.ts', 'c.ts'),
      fileEdge('b.ts', 'd.ts'),
      fileEdge('c.ts', 'd.ts'),
    ]);
    expect(edges).toEqual([]);
  });

  it('returns an empty array for a single unidirectional chain', () => {
    const edges = findCyclicFileEdges([fileEdge('a.ts', 'b.ts'), fileEdge('b.ts', 'c.ts'), fileEdge('c.ts', 'd.ts')]);
    expect(edges).toEqual([]);
  });

  it('flags a direct self-loop (a file whose resolved import points at itself)', () => {
    const selfLoop = fileEdge('a.ts', 'a.ts');
    expect(findCyclicFileEdges([selfLoop])).toEqual([selfLoop]);
  });

  it('flags a 2-file mutual cycle in both directions', () => {
    const edges = [fileEdge('a.ts', 'b.ts'), fileEdge('b.ts', 'a.ts')];
    expect(findCyclicFileEdges(edges)).toEqual(expect.arrayContaining(edges));
  });

  it('scopes flagging to the actual cyclic component when two separate cycles coexist', () => {
    const cycle1 = [fileEdge('a.ts', 'b.ts'), fileEdge('b.ts', 'a.ts')];
    const cycle2 = [fileEdge('x.ts', 'y.ts'), fileEdge('y.ts', 'x.ts')];
    const bridge = fileEdge('a.ts', 'x.ts'); // connects the two components but isn't itself cyclic
    const edges = findCyclicFileEdges([...cycle1, ...cycle2, bridge]);

    expect(edges).toHaveLength(4);
    expect(edges).toEqual(expect.arrayContaining([...cycle1, ...cycle2]));
    expect(edges).not.toEqual(expect.arrayContaining([bridge]));
  });

  it('returns an empty array for an empty input', () => {
    expect(findCyclicFileEdges([])).toEqual([]);
  });

  it('handles a real-scale long linear chain (20,000 files) without a stack overflow, and finds no cycle', () => {
    const edges: FileEdge[] = [];
    const CHAIN_LENGTH = 20_000;
    for (let i = 0; i < CHAIN_LENGTH - 1; i++) {
      edges.push(fileEdge(`file${i}.ts`, `file${i + 1}.ts`));
    }
    expect(() => findCyclicFileEdges(edges)).not.toThrow();
    expect(findCyclicFileEdges(edges)).toEqual([]);
  });

  it('handles a real-scale long cyclic chain (20,000 files, closed into one big cycle) without a stack overflow', () => {
    const edges: FileEdge[] = [];
    const CHAIN_LENGTH = 20_000;
    for (let i = 0; i < CHAIN_LENGTH; i++) {
      edges.push(fileEdge(`file${i}.ts`, `file${(i + 1) % CHAIN_LENGTH}.ts`));
    }
    let result: FileEdge[] = [];
    expect(() => {
      result = findCyclicFileEdges(edges);
    }).not.toThrow();
    expect(result).toHaveLength(CHAIN_LENGTH);
  });
});
