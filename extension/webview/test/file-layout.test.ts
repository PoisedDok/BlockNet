import { describe, expect, it } from 'vitest';
import type { MicroFileEdge, MicroFileNode } from '@blocknet/core';
import { layoutFiles } from '../src/flow/file-layout.js';

function file(id: string): MicroFileNode {
  return { id, name: id, path: id, loc: 1, risk: false };
}

function edge(id: string, source: string, target: string): MicroFileEdge {
  return { id, source, target, risk: false };
}

describe('layoutFiles', () => {
  it('returns a position for every file id', () => {
    const files = [file('a'), file('b'), file('c')];
    const positions = layoutFiles(files, []);
    expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'c']);
  });

  it('never produces NaN or undefined coordinates', () => {
    const files = [file('a'), file('b')];
    const positions = layoutFiles(files, [edge('e1', 'a', 'b')]);
    for (const id of ['a', 'b']) {
      expect(Number.isFinite(positions[id]?.x)).toBe(true);
      expect(Number.isFinite(positions[id]?.y)).toBe(true);
    }
  });

  it('places an edge target to the right of its source', () => {
    const files = [file('a'), file('b')];
    const positions = layoutFiles(files, [edge('e1', 'a', 'b')]);
    expect(positions.b!.x).toBeGreaterThan(positions.a!.x);
  });

  it('handles an edge whose endpoint is not in the file list without throwing', () => {
    const files = [file('a')];
    expect(() => layoutFiles(files, [edge('e1', 'a', 'ghost')])).not.toThrow();
  });

  it('handles zero files', () => {
    expect(layoutFiles([], [])).toEqual({});
  });

  it('is deterministic for the same input', () => {
    const files = [file('a'), file('b'), file('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
    const first = layoutFiles(files, edges);
    const second = layoutFiles(files, edges);
    expect(first).toEqual(second);
  });
});
