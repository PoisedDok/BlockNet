import type { Position } from './shared/protocol.js';

// workspaceState: persisted node positions (docs/architecture/PROTOCOL.md's layout/restore +
// layout/persist). Takes a narrow structural type — the two methods this file actually calls
// on vscode.Memento — instead of importing `vscode`, matching cache-bridge.ts's established
// pattern: a real vscode.Memento satisfies this shape, but so does a plain in-memory object in
// a test, so this stays unit-testable headlessly with no vscode mock (Layer 3, not Layer 4 —
// see docs/architecture/LAYERS.md).
export type WorkspaceMemento = {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
};

const POSITIONS_KEY = 'blocknet.positions';

/** The persisted positions map is deliberately sparse: only ids a user has actually moved (or
 * previously restored) — never a full snapshot of layout.ts's dagre output. A block id absent
 * from this map falls back to a fresh dagre-computed position (layout.ts + camera-store.ts),
 * which is what makes a newly-appeared block (a real code change) land somewhere sane instead
 * of being silently missing from a stale full-graph snapshot. */
export function getPositions(memento: WorkspaceMemento): Record<string, Position> {
  return memento.get(POSITIONS_KEY, {});
}

/** Replaces the persisted map wholesale — camera-store.ts always sends its full current
 * (sparse) override map on every layout/persist, never a delta, which naturally drops stale
 * ids once a fresh drag happens in a later session, and is safe for v1's actual scope: a
 * single workspace root, one window (VS Code focuses the existing window rather than opening
 * a second one on the same folder). Two-pass review correctly flagged that "can't lose a
 * concurrent write" doesn't actually hold in general — two independent windows on the same
 * workspace would each hold their own camera-store snapshot, and whichever persists last would
 * silently clobber the other's keys it never had. Not reachable in v1's supported shape, but a
 * real limit of this replace-not-merge design if that ever changes, not a guarantee it
 * provides. */
export function setPositions(memento: WorkspaceMemento, positions: Record<string, Position>): Thenable<void> {
  return memento.update(POSITIONS_KEY, positions);
}
