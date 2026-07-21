import { useEffect, useRef } from 'react';
import type { Risk } from '@blocknet/core';
import { postToHost } from '../host-bridge.js';
import './RiskPopover.css';

export type RiskPopoverProps = {
  risk: Risk;
  onClose: () => void;
};

/** A lightweight popover for a selected risk edge's oneLine/explain/fix + evidence
 * (TASKS-V1.md's Task 8 acceptance criteria) — deliberately not the full v2 connection
 * inspector (docs/planning/ROADMAP-V2.md). Fixed-position overlay rather than anchored to the
 * edge's own screen coordinates: computing that anchor correctly needs React Flow's
 * viewport-transform (flowToScreenPosition), real complexity for a purely cosmetic gain over
 * a corner panel, and out of scope for "lightweight." */
export function RiskPopover({ risk, onClose }: RiskPopoverProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // A keydown handler on a non-focused element never fires in a real browser — Escape is
  // dispatched at whatever currently has focus and bubbles UP the ancestor chain, it doesn't
  // descend into unfocused children. Confirmed as a real, live bug (not just theoretical) via
  // Playwright against the actual built app: jsdom's fireEvent.keyDown dispatches directly on
  // the target element regardless of focus, so RiskPopover.test.tsx's Escape test passed while
  // the real browser behavior was silently broken. tabIndex={-1} + focusing on mount makes the
  // dialog itself the focused (and thus bubbling-source) element — the standard WAI-ARIA
  // dialog pattern, not just a fix for this one bug.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div ref={dialogRef} className="bn-risk-popover" role="dialog" aria-label={risk.oneLine} tabIndex={-1} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="bn-risk-popover-header">
        <span className="bn-risk-popover-tag" data-tag={risk.tag}>
          {risk.tag}
        </span>
        <button type="button" className="bn-risk-popover-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="bn-risk-popover-oneline">{risk.oneLine}</p>
      <p className="bn-risk-popover-explain">{risk.explain}</p>
      <p className="bn-risk-popover-fix">
        <strong>Fix:</strong> {risk.fix}
      </p>
      {risk.evidence.length > 0 && (
        <ul className="bn-risk-popover-evidence">
          {risk.evidence.map((ev) => (
            <li key={`${ev.file}:${ev.line}`}>
              <button
                type="button"
                className="bn-risk-popover-evidence-loc"
                title={`Open ${ev.file} at line ${ev.line}`}
                onClick={() => postToHost({ type: 'open/file', fileId: ev.file, line: ev.line })}
              >
                {ev.file}:{ev.line}
              </button>
              <code className="bn-risk-popover-evidence-statement">{ev.statement}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
