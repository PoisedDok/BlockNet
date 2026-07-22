import type { BlockNode, Edge, LayerArrow, LayerEdge, LayerItem, Progress, Risk } from '@blocknet/core';

// The webview↔host message contract (docs/architecture/PROTOCOL.md). Designed to be imported
// verbatim by both extension/src/** and extension/webview/src/** (a relative cross-boundary
// import, no workspace-package indirection — see PROTOCOL.md's "why one file, not two") so a
// payload shape can never silently drift between the two sides.
//
// `webview/ready` exists purely to solve a postMessage ordering race: VS Code drops any
// postMessage sent before the webview's own `window.addEventListener('message', ...)` has
// registered — there's no queueing. Since `layout/restore` must reach the webview before
// `graph/macro` (PROTOCOL.md's ordering guarantee) and the host can't otherwise know when the
// freshly (re)loaded webview script has finished registering its listener, the webview posts
// `webview/ready` as its first action, and panel.ts's `whenReady()` gates every
// `layout/restore`/`graph/macro` send behind having actually received it.
//
// Its `generation` field closes a real re-entrancy gap two-pass review found: panel.ts
// reassigns webview.html on every createOrReveal('ready', ...) call, including a reveal of an
// already-'ready' panel, so a rapid double-invocation (e.g. a doubled keybinding) can leave
// TWO script instances racing to load before either posts ready. Without a generation to
// match against, an earlier invocation's whenReady() could resolve on the WRONG (superseded)
// script's ready message and post layout/restore/graph/macro into a webview that's already
// moved on — silently dropped by VS Code (no queue), losing the exact data this handshake
// exists to deliver. The webview echoes back whatever generation panel.ts's <meta
// name="blocknet-generation"> tag (webview-html.ts) told it to.

export type Position = { x: number; y: number };

// `BlockNode` itself stays core's frozen Checkpoint-B schema (docs/architecture/DATA-MODEL.md)
// — dirty-file state is an extension-host-only concern computed fresh on every push
// (docs/architecture/STATE-OWNERSHIP.md, `extension/src/git.ts`, Task 9), never something
// core's analysis engine knows about or emits. `WebviewBlockNode` is the protocol-layer
// augmentation for that, not a core type change. `graph/macro` (below) still carries this
// shape and still fires right after every analysis completes — v2.0.1's unified layer model
// (docs/planning/ROADMAP-V2.md) doesn't remove it, it just stops being what the webview
// renders directly: its arrival is the signal to issue a fresh `graph/layer/request('')`,
// which is what actually populates layer 0's mixed block/file/folder view.
export type WebviewBlockNode = BlockNode & { dirty: boolean };

// v2.0.1 unified layer model (docs/planning/ROADMAP-V2.md): same protocol-layer-augmentation
// pattern as WebviewBlockNode above. Distributes correctly over LayerItem's file/folder union —
// a WebviewLayerItem is either a dirty-augmented file item or a dirty-augmented folder item,
// never a malformed merge of both.
export type WebviewLayerItem = LayerItem & { dirty: boolean };

export type HostMessage =
  | { type: 'graph/macro'; nodes: WebviewBlockNode[]; edges: Edge[] }
  | { type: 'risks/update'; risks: Risk[] }
  // `edgeWaypoints` (ROADMAP-V2.md's draggable/bendable edge routing): same sparse-override
  // contract as `positions` — an id absent here falls through to its plain geometric default,
  // never a full snapshot of every item/edge in the graph. Each present waypoints value is an
  // ORDERED array of zero-or-more bend points (multi-point drag parity) — not a single
  // Position — source→target order, so an insertIndex from edge-path.ts's
  // nearestPointOnEdgePath is directly usable as an array splice index. ONE map each, spanning
  // every item (block, plain folder, or file) and every intra-layer edge at every depth — the
  // old macro/micro split into four separate maps is retired: every id is already globally
  // unique by repo-relative path (checked against state.ts, ROADMAP-V2.md's "State keying,
  // generalized"), so a single flat map can't collide across layers.
  | {
      type: 'layout/restore';
      positions: Record<string, Position>;
      edgeWaypoints: Record<string, Position[]>;
    }
  | ({ type: 'analysis/progress' } & Progress)
  // A layer request can fail (no cache yet, a stale/removed layerPath) in a way that's local
  // to the navigation the user just made, not a whole-panel failure — surfaced as its own
  // message instead of vscode.window.showErrorMessage so the webview can show an inline notice
  // and fall back to the previous layer, rather than being left in a perpetual "loading…"
  // transition with no way back for itself.
  | { type: 'graph/layer'; layerPath: string; items: WebviewLayerItem[]; edges: LayerEdge[]; arrows: LayerArrow[] }
  | { type: 'graph/layer/error'; layerPath: string; message: string };

export type WebviewMessage =
  | { type: 'webview/ready'; generation: string }
  | { type: 'open/file'; fileId: string; line?: number }
  | { type: 'open/diff'; fileId: string }
  | { type: 'layout/persist'; positions: Record<string, Position>; edgeWaypoints: Record<string, Position[]> }
  | { type: 'graph/layer/request'; layerPath: string };
