import { useEffect, useRef } from 'react';
import type { LayerDocFile } from '@blocknet/core';
import { postToHost } from '../host-bridge.js';
import './DocStackPopover.css';

export type DocStackPopoverProps = {
  files: LayerDocFile[];
  onClose: () => void;
};

/** A lightweight popover listing a doc-stack's own files (docs/planning/ROADMAP-V2.md's v2.0.1
 * doc-stack card) — mirrors RiskPopover.tsx's exact pattern (a fixed-position overlay, not
 * anchored to the card's own screen coordinates, same reasoning as that file's own comment),
 * deliberately NOT the unbuilt v2.1 Connection Inspector. Each row opens the REAL file in the
 * REAL editor via the same native-delegation `open/file` flow RiskPopover's evidence links
 * already use — never a webview-embedded editor (decisions/0009). */
export function DocStackPopover({ files, onClose }: DocStackPopoverProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Same WAI-ARIA dialog focus pattern as RiskPopover.tsx — see that file's own comment for
  // why a keydown handler on a non-focused element never fires in a real browser (confirmed
  // live, not just reasoned about).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      ref={dialogRef}
      className="bn-docstack-popover"
      role="dialog"
      aria-label={`${files.length} documentation file${files.length === 1 ? '' : 's'}`}
      tabIndex={-1}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="bn-docstack-popover-header">
        <span className="bn-docstack-popover-title">
          {files.length} documentation file{files.length === 1 ? '' : 's'}
        </span>
        <button type="button" className="bn-docstack-popover-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <ul className="bn-docstack-popover-files">
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className="bn-docstack-popover-file"
              title={`Open ${file.path}`}
              onClick={() => postToHost({ type: 'open/file', fileId: file.path })}
            >
              {file.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
