import type { KeyboardEvent, MouseEvent } from 'react';
import './FileCard.css';

export type FileCardProps = {
  name: string;
  path: string;
  loc: number;
  dirty: boolean;
  risk: boolean;
  selected: boolean;
  dimmed: boolean;
  onSelect?: () => void;
  onOpenInEditor?: () => void;
  /** False when mounted inside React Flow's own node wrapper — mirrors BlockCard's identical
   * prop and reasoning (avoids a doubled keyboard tab stop for one visual card). */
  interactive?: boolean;
};

/** Pure presentational card — mirrors BlockCard.tsx's shape at file granularity (no pills, no
 * connection-count badge: MicroFileNode carries neither, docs/architecture/DATA-MODEL.md). The
 * ⤢ button posts `open/file` (via the onOpenInEditor callback FileCanvas wires to postToHost) —
 * the same native-delegation flow RiskPopover's evidence links already use, never a
 * webview-embedded editor (decisions/0009). */
export function FileCard({ name, path, loc, dirty, risk, selected, dimmed, onSelect, onOpenInEditor, interactive = true }: FileCardProps) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.();
    }
  }

  function onOpenClick(e: MouseEvent) {
    // Stop propagation so clicking ⤢ doesn't also toggle the card's own selection — the two
    // are separate actions on the same card, the same nested-interactive-avoidance shape
    // RiskPopover's evidence buttons already established for open/file.
    e.stopPropagation();
    onOpenInEditor?.();
  }

  const label = `${name}, ${path}, ${loc} lines${dirty ? ', uncommitted changes' : ''}${risk ? ', part of a circular import' : ''}`;

  return (
    <div
      className="bn-file-card"
      data-selected={selected || undefined}
      data-risk={risk || undefined}
      style={{ opacity: dimmed ? 0.14 : 1 }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      aria-pressed={interactive ? selected : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
    >
      <div className="bn-file-card-row">
        <span className="bn-file-card-dot" aria-hidden="true" />
        <span className="bn-file-card-name">{name}</span>
        <div className="bn-file-card-spacer" />
        <button type="button" className="bn-file-card-open" title="Open in editor" aria-label={`Open ${name} in editor`} onClick={onOpenClick}>
          ⤢
        </button>
      </div>
      <div className="bn-file-card-path">{path}</div>
      {/* A separate badges row, not crammed onto the name row above: at the card's real width,
          name + ⤢ + LOC + dirty + risk together don't reliably fit on one line for a real file
          name (not just a short fixture stub) — confirmed live (not just reasoned about): with
          everything on one row, a long enough name shrank to 0px width (a flexbox min-width:auto
          pitfall, since fixed) and the risk pill still visually overlapped its neighbor once the
          name was widened back out. Splitting the row is the actual fix, not a wider magic-number
          card width chasing whatever the current fixture names happen to be. */}
      <div className="bn-file-card-badges">
        <span className="bn-file-card-loc">{loc} LOC</span>
        {dirty && (
          <span className="bn-file-card-dirty" title="Contains uncommitted changes">
            ● edited
          </span>
        )}
        {risk && <span className="bn-file-card-risk-pill">⚠ risk</span>}
      </div>
    </div>
  );
}
