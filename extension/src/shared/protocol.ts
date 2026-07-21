import type { BlockNode, Edge, Progress, Risk } from '@blocknet/core';

// The webview↔host message contract (docs/architecture/PROTOCOL.md). Designed to be imported
// verbatim by both extension/src/** and extension/webview/src/** so a payload shape can never
// silently drift between the two sides of the boundary — see PROTOCOL.md's "why one file, not
// two." extension/src/** already does; extension/webview/src/** doesn't yet — Task 7 built
// the webview against static fixture data (docs/planning/TASKS-V1.md), deliberately not this
// contract, and Task 8 is what actually wires postMessage on the webview side.

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
