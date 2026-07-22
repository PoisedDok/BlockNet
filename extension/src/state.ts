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
const EDGE_WAYPOINTS_KEY = 'blocknet.edgeWaypoints';

/** The persisted positions map is deliberately sparse: only ids a user has actually moved (or
 * previously restored) — never a full snapshot of a fresh dagre layout. An id absent from this
 * map falls back to a fresh dagre-computed position, which is what makes a newly-appeared item
 * (a real code change) land somewhere sane instead of being silently missing from a stale
 * full-graph snapshot. ONE map spanning every item at every layer (a block, a plain folder, or
 * a file) — v2.0.1's unified layer model (docs/planning/ROADMAP-V2.md) retired the old
 * separate block-only/file-only key pair, since every id is already globally unique by
 * repo-relative path and can't collide across layers. */
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

/** Same sparse-override contract as getPositions/setPositions above, applied to edge
 * waypoints (ROADMAP-V2.md's draggable/bendable edge routing) — a separate workspaceState key,
 * not folded into POSITIONS_KEY's own map, so the two concerns (item positions, edge
 * waypoints) stay independently readable/testable and neither's stored shape depends on the
 * other's. Spans every intra-layer edge at every depth, same unification as POSITIONS_KEY. */
export function getEdgeWaypoints(memento: WorkspaceMemento): Record<string, Position[]> {
  return memento.get(EDGE_WAYPOINTS_KEY, {});
}

/** Same "replaces, not merges" contract as setPositions above, and the same real limit: safe
 * for v1's actual scope (a single workspace root, one window), but two independent windows on
 * the same workspace would each hold their own camera-store snapshot, and whichever persists
 * last would silently clobber the other's edge-waypoint keys it never had. Not reachable in
 * v1's supported shape, but a real limit of this replace-not-merge design if that ever
 * changes, not a guarantee it provides. */
export function setEdgeWaypoints(memento: WorkspaceMemento, edgeWaypoints: Record<string, Position[]>): Thenable<void> {
  return memento.update(EDGE_WAYPOINTS_KEY, edgeWaypoints);
}
