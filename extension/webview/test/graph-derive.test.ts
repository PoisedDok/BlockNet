import { describe, expect, it } from 'vitest';
import type { BlockNode, Edge } from '@blocknet/core';
import { connectionCounts, relatedIds, siblingOffsets } from '../src/flow/graph-derive.js';

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

describe('siblingOffsets (parallel/anti-parallel edge separation)', () => {
  it('gives a lone edge between its two nodes an offset of 0', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
    expect(siblingOffsets(edges)).toEqual({ e1: 0, e2: 0 });
  });

  it('gives two edges between the SAME pair, same direction, symmetric non-zero offsets', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'a', 'b')];
    const offsets = siblingOffsets(edges);
    expect(offsets.e1).not.toBe(0);
    expect(offsets.e2).not.toBe(0);
    expect(offsets.e1).toBe(-offsets.e2!);
  });

  it('groups a RECIPROCAL pair (A→B and B→A) together — direction does not create separate groups', () => {
    // The exact real-world case this exists for: an import cycle risk shows up as two directed
    // edges between the same two blocks, reversed.
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')];
    const offsets = siblingOffsets(edges);
    expect(offsets.e1).not.toBe(0);
    expect(offsets.e2).not.toBe(0);
    expect(offsets.e1).toBe(-offsets.e2!);
  });

  it('does not confuse an unrelated third edge sharing only one endpoint', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'a'), edge('e3', 'a', 'c')];
    const offsets = siblingOffsets(edges);
    expect(offsets.e3).toBe(0);
    expect(offsets.e1).not.toBe(0);
  });

  it('assigns a distinct, stable-ordered offset to each of three-plus edges between the same pair, centered on 0', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')];
    const offsets = siblingOffsets(edges);
    const values = [offsets.e1!, offsets.e2!, offsets.e3!];
    expect(new Set(values).size).toBe(3); // all distinct
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(0); // symmetric around 0
    expect(values[0]).toBeLessThan(values[1]!);
    expect(values[1]).toBeLessThan(values[2]!);
  });

  it('is stable across re-derivation given the same edge order (no randomness/Map-iteration surprise)', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')];
    expect(siblingOffsets(edges)).toEqual(siblingOffsets(edges));
  });

  it('assigns the SAME offsets regardless of array order — not derived from array position', () => {
    // Regression: core's incremental re-analysis (core/src/analyze.ts) filters a modified
    // file's edges out of the cache and appends fresh ones at the end, so a routine save can
    // reorder a reciprocal pair in the array even though nothing about the graph changed. If
    // siblingOffsets keyed off array position, that reorder would silently flip which sibling
    // gets -22 vs +22.
    const inOriginalOrder = siblingOffsets([edge('e1', 'a', 'b'), edge('e2', 'b', 'a')]);
    const afterReanalysisReorder = siblingOffsets([edge('e2', 'b', 'a'), edge('e1', 'a', 'b')]);
    expect(afterReanalysisReorder).toEqual(inOriginalOrder);
  });

  it('assigns the SAME offsets regardless of array order for LARGER groups too (5+ edges between one pair)', () => {
    // extension/webview/src/fixtures/stress-graph.ts generates real groups this large between a
    // single block pair (its own dev/QA stress test) — this isn't a toy-sized case.
    const inGroup = [
      edge('e1', 'a', 'b'),
      edge('e2', 'b', 'a'),
      edge('e3', 'a', 'b'),
      edge('e4', 'b', 'a'),
      edge('e5', 'a', 'b'),
    ];
    const canonical = siblingOffsets(inGroup);
    const shuffled = siblingOffsets([inGroup[3]!, inGroup[0]!, inGroup[4]!, inGroup[1]!, inGroup[2]!]);
    const reversed = siblingOffsets([...inGroup].reverse());
    expect(shuffled).toEqual(canonical);
    expect(reversed).toEqual(canonical);
  });
});
