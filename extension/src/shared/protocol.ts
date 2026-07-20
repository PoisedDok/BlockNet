import type { BlockNode, Edge, Progress, Risk } from '@blocknet/core';

// The webview↔host message contract (docs/architecture/PROTOCOL.md). Imported verbatim by
// both extension/src/** and extension/webview/src/** (once Task 7 adds the latter) so a
// payload shape can never silently drift between the two sides of the boundary — see
// PROTOCOL.md's "why one file, not two."

export type Position = { x: number; y: number };

export type HostMessage =
  | { type: 'graph/macro'; nodes: BlockNode[]; edges: Edge[] }
  | { type: 'risks/update'; risks: Risk[] }
  | { type: 'layout/restore'; positions: Record<string, Position> }
  | ({ type: 'analysis/progress' } & Progress);

export type WebviewMessage =
  | { type: 'open/file'; fileId: string; line?: number }
  | { type: 'open/diff'; fileId: string }
  | { type: 'layout/persist'; positions: Record<string, Position> };
