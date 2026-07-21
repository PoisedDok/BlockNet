import './StatusBar.css';

export type StatusBarProps = {
  riskCount: number;
  /** v2.0 micro view (docs/planning/ROADMAP-V2.md): "System Map / <block>" breadcrumb, only
   * ever passed by FileCanvas.tsx (BlockCanvas.tsx never has a parent block to name).
   * `onBack` fires the same cross-fade-back-to-macro action as GraphView.tsx's dedicated
   * "← zoom out to map" button — the roadmap names both affordances explicitly. */
  breadcrumb?: { blockName: string; onBack: () => void };
};

export function StatusBar({ riskCount, breadcrumb }: StatusBarProps) {
  return (
    <div className="bn-status-bar">
      <div className="bn-brand">
        <span className="bn-brand-mark" aria-hidden="true" />
        <span className="bn-brand-name">BLOCKNET</span>
      </div>
      <div className="bn-status-divider" aria-hidden="true" />
      {breadcrumb && (
        <nav className="bn-breadcrumb" aria-label="Breadcrumb">
          <button type="button" className="bn-breadcrumb-root" onClick={breadcrumb.onBack}>
            System Map
          </button>
          <span className="bn-breadcrumb-sep" aria-hidden="true">
            /
          </span>
          <span className="bn-breadcrumb-current">{breadcrumb.blockName}</span>
        </nav>
      )}
      <div className="bn-legend" aria-label="Legend">
        <span className="bn-legend-item">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="22" y2="4" stroke="var(--bn-text-primary)" strokeWidth="1.6" strokeDasharray="2 5" />
          </svg>
          output → input
        </span>
        <span className="bn-legend-item bn-legend-risk">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="22" y2="4" stroke="var(--bn-risk)" strokeWidth="2" />
          </svg>
          structural risk
        </span>
      </div>
      <div className="bn-risk-count" role="status" data-active={riskCount > 0 || undefined}>
        <span className="bn-risk-count-dot" aria-hidden="true" />
        {riskCount} risk{riskCount === 1 ? '' : 's'} detected
      </div>
    </div>
  );
}
