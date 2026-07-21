import type { KeyboardEvent } from 'react';
import { blockAriaLabel } from './block-label.js';
import './BlockCard.css';

export type BlockCardProps = {
  name: string;
  path: string;
  pills: string[];
  riskCount: number;
  connectionCount: number;
  selected: boolean;
  dimmed: boolean;
  onSelect?: () => void;
  /** False when mounted inside React Flow's own node wrapper, which already owns
   * tabIndex/role/keyboard handling for the node — rendering a second nested interactive
   * element would double the keyboard tab stops for one visual card. Defaults to true for
   * standalone/testing use. */
  interactive?: boolean;
};

/** Pure presentational card — no React Flow dependency, so it's fully unit-testable in
 * isolation. BlockNode.tsx is the thin adapter that wraps this with RF's Handle anchors. */
export function BlockCard({
  name,
  path,
  pills,
  riskCount,
  connectionCount,
  selected,
  dimmed,
  onSelect,
  interactive = true,
}: BlockCardProps) {
  const hasRisk = riskCount > 0;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.();
    }
  }

  const label = blockAriaLabel({ name, path, riskCount, connectionCount });

  return (
    <div
      className="bn-card"
      data-selected={selected || undefined}
      data-risk={hasRisk || undefined}
      style={{ opacity: dimmed ? 0.14 : 1 }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      aria-pressed={interactive ? selected : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
    >
      <div className="bn-card-row">
        <span className="bn-card-dot" aria-hidden="true" />
        <span className="bn-card-name">{name}</span>
        {hasRisk && (
          <span className="bn-card-risk-pill">
            {riskCount}× ⚠
          </span>
        )}
      </div>
      <div className="bn-card-meta">
        <span className="bn-card-path">{path}</span>
        <span className="bn-card-connections">{connectionCount} link{connectionCount === 1 ? '' : 's'}</span>
      </div>
      {pills.length > 0 && (
        <div className="bn-card-pills">
          {pills.map((pill) => (
            <span className="bn-pill" key={pill}>
              {pill}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
