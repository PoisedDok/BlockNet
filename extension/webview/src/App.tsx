import { useEffect, useRef, useState } from 'react';
import type { Progress } from '@blocknet/core';
import { GraphView, type LayerErrorPayload, type LayerPayload } from './flow/GraphView.js';
import type { Position } from '../../src/shared/protocol.js';
import { sampleLayers } from './fixtures/sample-graph.js';
import { stressLayers } from './fixtures/stress-graph.js';
import { onHostMessage, postToHost } from './host-bridge.js';

// Dev/QA-only fixture bypass, never reachable from a real VS Code host: `?sample=1` (a small
// fixture exercising a real CIRCULAR cycle, a crossing boundary-style edge, a risk-free edge,
// and a loose root file not wrapped in any block at once) or `?stress=1` (30 blocks/100 edges,
// Task 7's stated scale target). Both render GraphView directly and never call LiveApp/
// host-bridge.ts — load-bearing, not just a convenience: acquireVsCodeApi() only exists inside
// a real VS Code webview, so LiveApp would throw immediately in a plain browser (e.g. `vite
// preview` for Playwright screenshot verification), which these two params exist to route
// around entirely.
const params = new URLSearchParams(window.location.search);
const fixture = params.has('stress') ? 'stress' : params.has('sample') ? 'sample' : undefined;

export function App() {
  if (fixture === 'stress') return <FixtureApp layers={stressLayers} />;
  if (fixture === 'sample') return <FixtureApp layers={sampleLayers} />;
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

/** Dev/QA fixture bypass for the v2.0.1 unified layer model (docs/planning/ROADMAP-V2.md) —
 * resolves a layer navigation against a static per-layerPath dataset instead of a real host
 * round-trip (postToHost is a no-op outside a real webview, host-bridge.ts's own documented
 * fallback, so nothing would ever answer a real `graph/layer/request` here). The setTimeout is
 * deliberate, not decorative: GraphView.tsx's loading-state and cross-fade logic assumes a real
 * async gap between request and response — resolving synchronously would never exercise that
 * path, the exact thing this fixture mode exists to let Playwright verify. Layer 0's data is
 * seeded synchronously (no artificial delay) so the first paint isn't itself gated on a fake
 * network round trip. */
function FixtureApp({ layers }: { layers: Record<string, LayerPayload> }) {
  const [layer, setLayer] = useState<LayerPayload | undefined>(layers['']);
  const [layerError, setLayerError] = useState<LayerErrorPayload | undefined>(undefined);

  function onRequestLayer(layerPath: string) {
    setTimeout(() => {
      const data = layers[layerPath];
      if (data) {
        setLayer(data);
        setLayerError(undefined);
      } else {
        setLayerError({ layerPath, message: `No fixture layer data for "${layerPath}"` });
      }
    }, 150);
  }

  return <GraphView layer={layer} layerError={layerError} onRequestLayer={onRequestLayer} />;
}

function LiveApp() {
  const [layer, setLayer] = useState<LayerPayload | undefined>(undefined);
  const [layerError, setLayerError] = useState<LayerErrorPayload | undefined>(undefined);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [edgeWaypoints, setEdgeWaypoints] = useState<Record<string, Position[]>>({});
  const [progress, setProgress] = useState<Progress | undefined>(undefined);

  // The layerPath GraphView last asked for — read (never written) by the graph/macro handler
  // below so a background re-analysis (a save, while the user is several layers deep) refreshes
  // THAT layer, not silently the root. A plain ref, not state: it must be current the instant a
  // graph/macro arrives, with no re-render in between, and nothing here needs to re-render when
  // it changes on its own. Not reset on unmount/remount — LiveApp mounts exactly once per panel
  // lifetime (App() never re-mounts it), so '' (root) is only ever the value for a session's
  // first-ever request, which is also the correct thing to re-request if a macro re-analysis
  // somehow raced the very first graph/layer/request.
  const currentLayerPathRef = useRef('');

  useEffect(() => {
    const unsubscribe = onHostMessage((message) => {
      switch (message.type) {
        case 'layout/restore':
          setPositions(message.positions);
          setEdgeWaypoints(message.edgeWaypoints);
          break;
        case 'graph/macro':
          // v2.0.1 unified layer model: graph/macro's own payload is no longer rendered
          // directly (its arrival still fires right after every analysis completes, unchanged
          // extension-host behavior) — its arrival is now just the signal that a fresh cache
          // exists, so a graph/layer/request can be (re)issued. Re-requesting whatever layer
          // is CURRENT (not hardcoded to root) is load-bearing, not cosmetic: a save-triggered
          // re-analysis while the user is several layers deep must refresh what they're actually
          // looking at — re-requesting root every time would leave a deep layer showing stale
          // pre-edit data until the user manually backed all the way out and back in, since
          // GraphView only applies an incoming graph/layer response whose layerPath matches its
          // own current or pending layer (a real gap found while reconciling this flow against
          // docs/architecture/FLOWS.md, fixed here rather than documented as-is).
          postToHost({ type: 'graph/layer/request', layerPath: currentLayerPathRef.current });
          break;
        case 'analysis/progress':
          setProgress(message);
          break;
        case 'risks/update':
          // Deliberately not consumed: every risk this UI shows already comes from a layer's
          // own edge.risk/item.riskCount, the exact same underlying Risk data this message
          // would otherwise duplicate. See protocol.ts.
          break;
        case 'graph/layer':
          setLayer({ layerPath: message.layerPath, items: message.items, edges: message.edges, arrows: message.arrows });
          setLayerError(undefined);
          break;
        case 'graph/layer/error':
          setLayerError({ layerPath: message.layerPath, message: message.message });
          break;
        default: {
          // Exhaustiveness guard: if HostMessage ever gains a variant with no case above, this
          // line fails to compile (message narrows to `never` only when every case is
          // handled) instead of silently compiling and dropping the new message type at
          // runtime with zero signal.
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

  if (!layer) {
    return (
      <div className="bn-loading" role="status">
        {progress ? `Analyzing — ${progress.phase} ${progress.done}/${progress.total}` : 'Analyzing workspace…'}
      </div>
    );
  }

  return (
    <GraphView
      layer={layer}
      layerError={layerError}
      onRequestLayer={(layerPath) => {
        currentLayerPathRef.current = layerPath;
        postToHost({ type: 'graph/layer/request', layerPath });
      }}
      initialPositions={positions}
      initialEdgeWaypoints={edgeWaypoints}
    />
  );
}
