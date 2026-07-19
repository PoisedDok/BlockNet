// CIRCULAR risk detection (docs/decisions/0006): Tarjan's strongly-connected-components
// algorithm over the file-level import graph, always run over the FULL edge list on every
// analysis — never incrementally scoped (docs/decisions/0008: an edge addition/removal can
// merge or split SCCs in a way no local view can detect, and whole-graph Tarjan is already an
// O(V+E) pass cheap enough that scoping buys nothing).
//
// Hand-rolled and deliberately ITERATIVE, not the textbook recursive formulation
// (docs/architecture/DIRECTORY-TREE.md calls this out explicitly). A recursive DFS's call
// stack depth tracks the *longest import chain* in the repo, not file count — real repos
// build long layered chains (a barrel re-export cascade, a deep service-call layering) that
// can run into the thousands of files, and V8's default stack depth is nowhere near that.
// This is the same class of mistake this session already found and fixed once for
// structural.ts's symlink walk (docs/decisions/0005) — an algorithm whose cost/safety was
// never checked against real-repo shape, not just plausible on a fixture. Proven safe here by
// a 20,000-node linear-chain regression test (both acyclic and, separately, closed into one
// giant cycle) in risks.cycles.test.ts.
import type { FileEdge } from '../types.js';

type Frame = { node: string; neighbors: string[]; i: number };

/**
 * Returns exactly the FileEdges whose source and target both belong to the same strongly
 * connected component of size > 1 (a real, multi-file cycle) — or a direct self-loop
 * (source === target), which is a cycle regardless of SCC size bookkeeping. Every other edge,
 * including one that merely touches a cyclic file from outside the cycle, is not returned.
 */
export function findCyclicFileEdges(fileEdges: FileEdge[]): FileEdge[] {
  if (fileEdges.length === 0) return [];

  const adjacency = new Map<string, string[]>();
  for (const edge of fileEdges) {
    let neighbors = adjacency.get(edge.sourceFile);
    if (!neighbors) {
      neighbors = [];
      adjacency.set(edge.sourceFile, neighbors);
    }
    neighbors.push(edge.targetFile);
    if (!adjacency.has(edge.targetFile)) adjacency.set(edge.targetFile, []);
  }

  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const tarjanStack: string[] = [];
  const sccOf = new Map<string, number>();
  const sccSize = new Map<number, number>();
  let nextIndex = 0;
  let nextSccId = 0;

  for (const start of adjacency.keys()) {
    if (index.has(start)) continue;

    // Explicit work-stack simulating strongconnect()'s recursive call stack.
    const work: Frame[] = [{ node: start, neighbors: adjacency.get(start) ?? [], i: 0 }];
    index.set(start, nextIndex);
    lowlink.set(start, nextIndex);
    nextIndex++;
    tarjanStack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1] as Frame;

      if (frame.i < frame.neighbors.length) {
        const next = frame.neighbors[frame.i] as string;
        frame.i++;

        if (!index.has(next)) {
          index.set(next, nextIndex);
          lowlink.set(next, nextIndex);
          nextIndex++;
          tarjanStack.push(next);
          onStack.add(next);
          work.push({ node: next, neighbors: adjacency.get(next) ?? [], i: 0 });
        } else if (onStack.has(next)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node) as number, index.get(next) as number));
        }
        continue;
      }

      // All neighbors visited — this frame is done. Propagate its lowlink to its caller
      // (the recursive-call-return step), then close its SCC if it's a root.
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        lowlink.set(parent.node, Math.min(lowlink.get(parent.node) as number, lowlink.get(frame.node) as number));
      }

      if (lowlink.get(frame.node) === index.get(frame.node)) {
        const members: string[] = [];
        let w: string;
        do {
          w = tarjanStack.pop() as string;
          onStack.delete(w);
          sccOf.set(w, nextSccId);
          members.push(w);
        } while (w !== frame.node);
        sccSize.set(nextSccId, members.length);
        nextSccId++;
      }
    }
  }

  return fileEdges.filter((edge) => {
    if (edge.sourceFile === edge.targetFile) return true;
    const sourceScc = sccOf.get(edge.sourceFile);
    const targetScc = sccOf.get(edge.targetFile);
    return sourceScc !== undefined && sourceScc === targetScc && (sccSize.get(sourceScc) ?? 0) > 1;
  });
}
