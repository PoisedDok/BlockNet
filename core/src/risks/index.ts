// Runs every risk check (docs/decisions/0006) and merges the results: the canonical `Risk[]`
// (every finding, grouped per directed block pair) plus a copy of the block-level `Edge[]`
// with `.risk` attached where a check flagged that pair.
//
// A CIRCULAR risk only ever covers the CROSSING portion of a cyclic file-edge set — a file
// edge that's part of a cycle but stays entirely inside one block (e.g. a barrel file
// re-exporting a sibling in the same block) is a real fact, but block-aggregate.ts never
// creates an Edge for same-block pairs in the first place, so there is no block-level Edge to
// attach it to. That's a deliberate v1 scope boundary (a whole-cycle-within-one-block finding
// is file/micro-view territory, docs/planning/ROADMAP-V2.md), not a gap — the crossing edges
// of the SAME cycle (which is what actually threatens the "block-level architecture graph"
// v1 promises) are still fully flagged.
//
// A directed block pair can carry BOTH tags at once (some of its underlying file edges are
// cyclic, others are separate deep imports) — both Risk objects always survive into the
// returned `risks[]`, but `Edge.risk` is a single slot, so CIRCULAR wins the badge: cycles
// are a hard graph fact with ~zero false positives by construction (docs/decisions/0006),
// while boundary's precision depends on the declared-entry definition, making it the
// comparatively softer signal when both are true for the same pair.
import { resolveBlock } from '../edges/resolve-block.js';
import type { BlockNode, Edge, Evidence, FileEdge, Risk } from '../types.js';
import { findBoundaryViolations } from './boundary.js';
import { findCyclicFileEdges } from './cycles.js';

function pairKey(source: string, target: string): string {
  return `${source}\0${target}`;
}

function toEvidence(fileEdges: FileEdge[]): Evidence[] {
  return fileEdges.map((e) => ({ file: e.sourceFile, line: e.line, statement: e.statement }));
}

function groupByBlockPair(fileEdges: FileEdge[], blocks: BlockNode[]): Map<string, { source: string; target: string; edges: FileEdge[] }> {
  const groups = new Map<string, { source: string; target: string; edges: FileEdge[] }>();
  for (const fileEdge of fileEdges) {
    const source = resolveBlock(fileEdge.sourceFile, blocks);
    const target = resolveBlock(fileEdge.targetFile, blocks);
    const key = pairKey(source, target);
    let group = groups.get(key);
    if (!group) {
      group = { source, target, edges: [] };
      groups.set(key, group);
    }
    group.edges.push(fileEdge);
  }
  return groups;
}

function buildCircularRisk(source: string, target: string, edges: FileEdge[], names: Map<string, string>): Risk {
  const sourceName = names.get(source) ?? source;
  const targetName = names.get(target) ?? target;
  return {
    tag: 'CIRCULAR',
    oneLine: `Circular import between ${sourceName} and ${targetName}`,
    explain:
      `${edges.length} import${edges.length === 1 ? '' : 's'} from ${sourceName} to ${targetName} ` +
      `are part of a circular dependency — changes to either block can break the other.`,
    fix: 'Extract the shared contract into a third package.',
    source,
    target,
    evidence: toEvidence(edges),
  };
}

function buildBoundaryRisk(source: string, target: string, edges: FileEdge[], names: Map<string, string>): Risk {
  const sourceName = names.get(source) ?? source;
  const targetName = names.get(target) ?? target;
  return {
    tag: 'BOUNDARY',
    oneLine: `Deep import into ${targetName}'s internals`,
    explain:
      `${sourceName} imports ${edges.length} path${edges.length === 1 ? '' : 's'} inside ${targetName} that ` +
      `${edges.length === 1 ? "isn't" : "aren't"} part of its declared entry surface (package.json exports/main, or its conventional index file).`,
    fix: `Import from ${targetName}'s declared entry point instead, or add the path to its package.json exports if it's meant to be public.`,
    source,
    target,
    evidence: toEvidence(edges),
  };
}

const RISK_PRIORITY: Record<Risk['tag'], number> = { CIRCULAR: 0, BOUNDARY: 1 };

export function runRiskChecks(fileEdges: FileEdge[], blocks: BlockNode[], edges: Edge[], rootDir: string): { edges: Edge[]; risks: Risk[] } {
  const names = new Map(blocks.map((b) => [b.id, b.name]));

  const cyclicFileEdges = findCyclicFileEdges(fileEdges).filter(
    (e) => resolveBlock(e.sourceFile, blocks) !== resolveBlock(e.targetFile, blocks),
  );
  const boundaryFileEdges = findBoundaryViolations(fileEdges, blocks, rootDir);

  const risks: Risk[] = [];
  for (const group of groupByBlockPair(cyclicFileEdges, blocks).values()) {
    risks.push(buildCircularRisk(group.source, group.target, group.edges, names));
  }
  for (const group of groupByBlockPair(boundaryFileEdges, blocks).values()) {
    risks.push(buildBoundaryRisk(group.source, group.target, group.edges, names));
  }

  const risksByPair = new Map<string, Risk[]>();
  for (const risk of risks) {
    const key = pairKey(risk.source, risk.target);
    const list = risksByPair.get(key);
    if (list) list.push(risk);
    else risksByPair.set(key, [risk]);
  }

  const updatedEdges = edges.map((edge) => {
    const candidates = risksByPair.get(pairKey(edge.source, edge.target));
    if (!candidates || candidates.length === 0) return edge;
    const chosen = [...candidates].sort((a, b) => RISK_PRIORITY[a.tag] - RISK_PRIORITY[b.tag])[0];
    return chosen ? { ...edge, risk: chosen } : edge;
  });

  return { edges: updatedEdges, risks };
}
