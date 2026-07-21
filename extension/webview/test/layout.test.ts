import { describe, expect, it } from 'vitest';
import type { BlockNode, Edge } from '@blocknet/core';
import { layoutBlocks } from '../src/flow/layout.js';

function block(id: string): BlockNode {
  return { id, name: id, path: id, pills: [], fileCount: 1, riskCount: 0 };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target, importCount: 1 };
}

describe('layoutBlocks', () => {
  it('returns a position for every node id', () => {
    const nodes = [block('a'), block('b'), block('c')];
    const positions = layoutBlocks(nodes, []);
    expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'c']);
  });

  it('never produces NaN or undefined coordinates', () => {
    const nodes = [block('a'), block('b')];
    const positions = layoutBlocks(nodes, [edge('e1', 'a', 'b')]);
    for (const id of ['a', 'b']) {
      expect(Number.isFinite(positions[id]?.x)).toBe(true);
      expect(Number.isFinite(positions[id]?.y)).toBe(true);
    }
  });

  it('places an edge target to the right of its source (left-to-right import flow)', () => {
    const nodes = [block('a'), block('b')];
    const positions = layoutBlocks(nodes, [edge('e1', 'a', 'b')]);
    expect(positions.b!.x).toBeGreaterThan(positions.a!.x);
  });

  it('spreads unconnected nodes apart rather than stacking them at one point', () => {
    const nodes = [block('a'), block('b'), block('c')];
    const positions = layoutBlocks(nodes, []);
    const pts = ['a', 'b', 'c'].map((id) => positions[id]!);
    const distinct = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(distinct.size).toBe(3);
  });

  it('is deterministic for the same input', () => {
    const nodes = [block('a'), block('b'), block('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
    const first = layoutBlocks(nodes, edges);
    const second = layoutBlocks(nodes, edges);
    expect(first).toEqual(second);
  });

  it('handles an edge whose endpoint is not in the node list without throwing', () => {
    const nodes = [block('a')];
    expect(() => layoutBlocks(nodes, [edge('e1', 'a', 'ghost')])).not.toThrow();
  });

  it('handles zero nodes', () => {
    expect(layoutBlocks([], [])).toEqual({});
  });

  it('lays out a 30-node/100-edge graph without overlapping node centers', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => block(`n${i}`));
    const edges = Array.from({ length: 100 }, (_, i) => edge(`e${i}`, `n${i % 30}`, `n${(i * 7 + 3) % 30}`)).filter(
      (e) => e.source !== e.target,
    );
    const positions = layoutBlocks(nodes, edges);
    expect(Object.keys(positions)).toHaveLength(30);
    const seen = new Set<string>();
    for (const id of Object.keys(positions)) {
      const key = `${positions[id]!.x},${positions[id]!.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
