import './ZoomControls.css';

export type ZoomControlsProps = {
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
};

export function ZoomControls({ zoomPercent, onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
  return (
    <div className="bn-zoom-controls" role="group" aria-label="Zoom controls">
      <button type="button" className="bn-zoom-btn" onClick={onZoomOut} aria-label="Zoom out">
        −
      </button>
      <span className="bn-zoom-pct" aria-hidden="true">
        {zoomPercent}%
      </span>
      <button type="button" className="bn-zoom-btn" onClick={onZoomIn} aria-label="Zoom in">
        +
      </button>
      <div className="bn-zoom-divider" aria-hidden="true" />
      <button type="button" className="bn-zoom-reset" onClick={onReset}>
        reset
      </button>
    </div>
  );
}
