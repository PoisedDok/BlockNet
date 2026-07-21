import { useEffect, useState } from 'react';
import type { Edge, Progress } from '@blocknet/core';
import { BlockCanvas } from './flow/BlockCanvas.js';
import type { Position } from './flow/layout.js';
import { sampleNodes, sampleEdges } from './fixtures/sample-graph.js';
import { stressNodes, stressEdges } from './fixtures/stress-graph.js';
import { onHostMessage, postToHost } from './host-bridge.js';
import type { WebviewBlockNode } from '../../src/shared/protocol.js';

// Dev/QA-only fixture bypass, never reachable from a real VS Code host: `?sample=1` (the 5-
// block fixture exercising a real CIRCULAR cycle, a BOUNDARY deep-import, and a risk-free edge
// at once) or `?stress=1` (30 blocks/100 edges, Task 7's stated scale target). Both render
// BlockCanvas directly and never call LiveApp/host-bridge.ts — load-bearing, not just a
// convenience: acquireVsCodeApi() only exists inside a real VS Code webview, so LiveApp would
// throw immediately in a plain browser (e.g. `vite preview` for Playwright screenshot
// verification), which these two params exist to route around entirely.
const params = new URLSearchParams(window.location.search);
const fixture = params.has('stress') ? 'stress' : params.has('sample') ? 'sample' : undefined;

export function App() {
  if (fixture === 'stress') return <BlockCanvas nodes={stressNodes} edges={stressEdges} />;
  if (fixture === 'sample') return <BlockCanvas nodes={sampleNodes} edges={sampleEdges} />;
  // acquireVsCodeApi() only exists inside a real VS Code webview — LiveApp would throw on
  // mount without it (an uncaught ReferenceError crashing to a blank page with no message),
  // which is exactly the confusing failure this dev-mode check exists to replace with an
  // actionable one. A real VS Code webview always injects this global before the script runs,
  // so this branch is unreachable there.
  if (typeof acquireVsCodeApi !== 'function') {
    return (
      <div className="bn-loading" role="status">
        No VS Code host detected — open with ?sample=1 or ?stress=1 for a static preview.
      </div>
    );
  }
  return <LiveApp />;
}

type Graph = { nodes: WebviewBlockNode[]; edges: Edge[] };

function LiveApp() {
  const [graph, setGraph] = useState<Graph | undefined>(undefined);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [progress, setProgress] = useState<Progress | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = onHostMessage((message) => {
      switch (message.type) {
        case 'layout/restore':
          setPositions(message.positions);
          break;
        case 'graph/macro':
          setGraph({ nodes: message.nodes, edges: message.edges });
          break;
        case 'analysis/progress':
          setProgress(message);
          break;
        case 'risks/update':
          // Deliberately not consumed: every risk this UI shows (StatusBar's count,
          // RiskPopover's detail) already comes from graph/macro's own edge.risk — the exact
          // same Risk objects this message would otherwise duplicate. See PROTOCOL.md.
          break;
        default: {
          // Exhaustiveness guard: if HostMessage ever gains a variant with no case above, this
          // line fails to compile (message narrows to `never` only when every case is
          // handled) instead of silently compiling and dropping the new message type at
          // runtime with zero signal — confirmed as a real gap by two-pass review (a repro
          // under this exact tsconfig's strict flags compiled clean without this guard).
          const exhaustive: never = message;
          void exhaustive;
        }
      }
    });
    // panel.ts's whenReady() only resolves for a 'webview/ready' whose generation matches the
    // one it minted for the currently-loaded script (PROTOCOL.md's ready-handshake) — echoing
    // back a value read from a nonexistent meta tag would just never match, indistinguishable
    // from never posting at all, so this defaults to '' rather than throwing if the meta tag
    // is somehow missing (dev/QA fixture modes never reach this branch at all — see App()).
    const generation = document.querySelector('meta[name="blocknet-generation"]')?.getAttribute('content') ?? '';
    postToHost({ type: 'webview/ready', generation });
    return unsubscribe;
  }, []);

  if (!graph) {
    return (
      <div className="bn-loading" role="status">
        {progress ? `Analyzing — ${progress.phase} ${progress.done}/${progress.total}` : 'Analyzing workspace…'}
      </div>
    );
  }

  return <BlockCanvas nodes={graph.nodes} edges={graph.edges} initialPositions={positions} />;
}
