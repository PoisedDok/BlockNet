import type { LayerArrow } from '@blocknet/core';
import './InterLayerArrows.css';

export type InterLayerArrowsProps = {
  /** Already scoped to ONE node — every arrow here shares the same sourceItemId (LayerCanvas's
   * own grouping, not this component's job). Renders nothing when empty, never an empty
   * wrapper element. */
  arrows: LayerArrow[];
  onNavigate: (targetFile: string) => void;
};

/** Inter-layer connections (docs/planning/ROADMAP-V2.md's v2.0.1) — a small clickable arrow
 * row anchored to the bottom edge of its source card, one per DISTINCT off-screen target file
 * (same-target edges already collapsed into one LayerArrow by core's resolveLayerConnections()
 * before this ever renders — this component has no aggregation logic of its own). Direction
 * (↓ deeper / ↑ shallower-or-cousin) is a depth-relative hint, not a literal reachability claim
 * (ROADMAP-V2.md's "Inter-layer direction, precise rule") — clicking always resolves and
 * navigates through the real path regardless of which way the chevron pointed. Deliberately NOT
 * a routable React Flow edge: there is no real target node on screen to draw a line to, and
 * these never support waypoint dragging (a static, aggregated indicator, not an editable
 * connection). */
export function InterLayerArrows({ arrows, onNavigate }: InterLayerArrowsProps) {
  if (arrows.length === 0) return null;
  return (
    <div className="bn-inter-layer-arrows">
      {arrows.map((arrow) => {
        const targetName = arrow.targetFile.split('/').at(-1) ?? arrow.targetFile;
        const directionWord = arrow.direction === 'down' ? 'Deeper' : 'Shallower';
        return (
          <button
            key={arrow.id}
            type="button"
            className="bn-inter-layer-arrow"
            data-direction={arrow.direction}
            data-risk={arrow.risk || undefined}
            title={`${directionWord}: ${arrow.targetFile}`}
            aria-label={`Go to ${arrow.targetFile}, ${directionWord.toLowerCase()} in the layer stack`}
            onClick={(e) => {
              // Stops this from also bubbling into the node's own click/selection handling —
              // the same nested-interactive-avoidance shape FileCard's ⤢ button already
              // established for open/file.
              e.stopPropagation();
              onNavigate(arrow.targetFile);
            }}
            // A native dblclick is a SEPARATE event from two click events — stopping click's
            // propagation above does not stop this one from also bubbling into the node's own
            // onNodeDoubleClick (React Flow's dive handler). Without this, double-clicking an
            // arrow badge (a plausible mis-click, sitting right at a card's edge) would ALSO
            // drill into the folder underneath it.
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <span aria-hidden="true">{arrow.direction === 'down' ? '↓' : '↑'}</span>
            {targetName}
          </button>
        );
      })}
    </div>
  );
}
