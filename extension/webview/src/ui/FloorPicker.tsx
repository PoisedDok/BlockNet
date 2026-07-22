import './FloorPicker.css';

export type FloorPickerEntry = { path: string; name: string };

export type FloorPickerProps = {
  /** Root-to-current, exactly GraphView.tsx's own navigation stack — index 0 is always the
   * repo root ("System Map"), the last entry is the currently-shown layer. */
  stack: FloorPickerEntry[];
  onJumpTo: (index: number) => void;
};

/** Layer-stack navigator (docs/planning/ROADMAP-V2.md's v2.0.1) — the Google Maps indoor
 * floor-picker pattern: a fixed, top-left vertical stack of slab buttons, one per depth level
 * from the repo root down to the current layer, current one highlighted. Flat 2D styling
 * (shadow/layering for depth cues, not a 3D perspective scene — that doc's own decided design).
 * Replaces StatusBar's old hardcoded two-level breadcrumb entirely: this is the ONE navigation
 * surface for a session, docked at the GraphView level, not owned by any one LayerCanvas
 * instance. Root renders first (top of the stack) and deeper layers render below it, matching
 * this project's own "down = deeper" depth convention for inter-layer arrows — the same mental
 * model, applied to the navigator that sits beside them. */
export function FloorPicker({ stack, onJumpTo }: FloorPickerProps) {
  const currentIndex = stack.length - 1;
  return (
    <nav className="bn-floor-picker" aria-label="Layer depth">
      {stack.map((entry, index) => {
        const isCurrent = index === currentIndex;
        const label = index === 0 ? 'System Map' : entry.name;
        return (
          <button
            key={entry.path}
            type="button"
            className="bn-floor-slab"
            data-current={isCurrent || undefined}
            aria-current={isCurrent ? 'true' : undefined}
            title={label}
            onClick={() => onJumpTo(index)}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
