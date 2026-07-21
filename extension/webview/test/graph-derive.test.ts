import { describe, expect, it } from 'vitest';
import type { BlockNode, Edge } from '@blocknet/core';
import { connectionCounts, relatedIds } from '../src/flow/graph-derive.js';

function block(id: string): BlockNode {
  return { id, name: id, path: id, pills: [], fileCount: 1, riskCount: 0 };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target, importCount: 1 };
}

describe('relatedIds', () => {
  const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];

  it('returns null when nothing is selected', () => {
    expect(relatedIds(null, edges)).toBeNull();
  });

  it('includes a selected node and its direct neighbors only', () => {
    const related = relatedIds({ type: 'node', id: 'b' }, edges);
    expect(related).toEqual(new Set(['b', 'a', 'c']));
  });

  it('excludes non-adjacent nodes from a node selection', () => {
    const related = relatedIds({ type: 'node', id: 'a' }, edges);
    expect(related?.has('c')).toBe(false);
  });

  it('includes exactly the two endpoints for a selected edge', () => {
    const related = relatedIds({ type: 'edge', id: 'e1' }, edges);
    expect(related).toEqual(new Set(['a', 'b']));
  });

  it('returns an empty set for a selected edge id that no longer exists', () => {
    const related = relatedIds({ type: 'edge', id: 'ghost' }, edges);
    expect(related).toEqual(new Set());
  });
});

describe('connectionCounts', () => {
  it('counts edges touching each block from either direction', () => {
    const nodes = [block('a'), block('b'), block('c')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'a', 'c')];
    expect(connectionCounts(nodes, edges)).toEqual({ a: 2, b: 2, c: 2 });
  });

  it('is zero for a block with no edges', () => {
    const nodes = [block('a'), block('b')];
    expect(connectionCounts(nodes, [])).toEqual({ a: 0, b: 0 });
  });

  it('counts a self-referential edge once, not twice', () => {
    const nodes = [block('a')];
    expect(connectionCounts(nodes, [edge('e1', 'a', 'a')])).toEqual({ a: 1 });
  });
});
