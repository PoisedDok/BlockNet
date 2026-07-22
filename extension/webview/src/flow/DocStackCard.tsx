import type { KeyboardEvent } from 'react';
import './DocStackCard.css';

export type DocStackCardProps = {
  count: number;
  selected: boolean;
  dimmed: boolean;
  onSelect?: () => void;
  /** False when mounted inside React Flow's own node wrapper — mirrors BlockCard/FileCard's
   * identical prop and reasoning (avoids a doubled keyboard tab stop for one visual card). */
  interactive?: boolean;
};

/** A layer's own loose documentation files, collapsed into one card (docs/planning/
 * ROADMAP-V2.md's v2.0.1 doc-stack card — real-repo-motivated: this repo's own `docs/` tree
 * has dozens of small one-concept files that would otherwise render as a long vertical pile).
 * Visual scales with volume: 2-3 files is a compact stacked-paper look reusing the SAME
 * stacked-slab visual language as the layer-stack floor-picker; more than 3 renders sized and
 * styled like a full folder-block card so a real `docs/`-sized cluster reads as "a meaningful
 * group," not clutter — still exactly one card either way, never a pile. Clicking it opens a
 * popover (DocStackPopover.tsx), never a layer dive — this is not a folder-card pretending to
 * be a folder. */
export function DocStackCard({ count, selected, dimmed, onSelect, interactive = true }: DocStackCardProps) {
  const large = count > 3;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.();
    }
  }

  return (
    <div
      className="bn-docstack-card"
      data-large={large || undefined}
      data-selected={selected || undefined}
      style={{ opacity: dimmed ? 0.14 : 1 }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${count} documentation file${count === 1 ? '' : 's'}` : undefined}
      aria-pressed={interactive ? selected : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
    >
      <div className="bn-docstack-layers" aria-hidden="true">
        <span className="bn-docstack-layer" />
        <span className="bn-docstack-layer" />
        <span className="bn-docstack-layer" />
      </div>
      <div className="bn-docstack-label">
        <span className="bn-docstack-count">{count}</span> docs
      </div>
    </div>
  );
}
