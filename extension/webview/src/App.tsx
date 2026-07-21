import { BlockCanvas } from './flow/BlockCanvas.js';
import { sampleNodes, sampleEdges } from './fixtures/sample-graph.js';
import { stressNodes, stressEdges } from './fixtures/stress-graph.js';

// Task 7 (docs/planning/TASKS-V1.md): static fixture data only — the live graph/macro +
// risks/update bridge over postMessage is Task 8's job, not this one. `?stress=1` switches to
// the 30-block/100-edge fixture for manually verifying pan/zoom/drag/select stays smooth at
// Task 7's stated scale target; it's a query param, not a UI control, and never ships wired
// to anything beyond this dev/QA convenience.
const useStressFixture = new URLSearchParams(window.location.search).has('stress');

export function App() {
  const nodes = useStressFixture ? stressNodes : sampleNodes;
  const edges = useStressFixture ? stressEdges : sampleEdges;
  return <BlockCanvas nodes={nodes} edges={edges} />;
}
