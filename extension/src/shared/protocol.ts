import type { BlockNode, Edge, MicroFileEdge, MicroFileNode, Progress, Risk } from '@blocknet/core';

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
// augmentation for that, not a core type change: the one place a `BlockNode` crosses into
// `graph/macro` gains exactly the one field the host adds on top.
export type WebviewBlockNode = BlockNode & { dirty: boolean };

// v2.0 micro view (docs/planning/ROADMAP-V2.md): same protocol-layer-augmentation pattern as
// WebviewBlockNode above — dirty-file state is an extension-host-only concern
// (STATE-OWNERSHIP.md) core's MicroFileNode never carries. commands/show-architecture.ts's
// triggerMicroAnalysis is the one place a plain MicroFileNode gains the field, right before
// posting `graph/micro`.
export type WebviewMicroFileNode = MicroFileNode & { dirty: boolean };

export type HostMessage =
  | { type: 'graph/macro'; nodes: WebviewBlockNode[]; edges: Edge[] }
  | { type: 'risks/update'; risks: Risk[] }
  // `edgeWaypoints` (ROADMAP-V2.md's draggable/bendable edge routing): same sparse-override
  // contract as `positions` — an edge id absent here falls through to its plain
  // geometric-midpoint curve, never a full snapshot of every edge in the graph. Each present
  // value is an ORDERED array of zero-or-more bend points (multi-point drag parity) — not a
  // single Position — source→target order, so an insertIndex from edge-path.ts's
  // nearestPointOnEdgePath is directly usable as an array splice index.
  // `filePositions`/`fileEdgeWaypoints` (ROADMAP-V2.md's file-level drag parity): the
  // identical sparse-override contract, applied to every file/micro-edge a user has ever
  // dragged across every block, not just the block currently being viewed — sent eagerly here
  // (like `positions`/`edgeWaypoints`) rather than per-dive, since GraphView.tsx owns this map
  // for the panel's whole lifetime and seeds every FileCanvas mount from it, including a
  // same-session re-dive into a previously-visited block.
  | {
      type: 'layout/restore';
      positions: Record<string, Position>;
      edgeWaypoints: Record<string, Position[]>;
      filePositions: Record<string, Position>;
      fileEdgeWaypoints: Record<string, Position[]>;
    }
  | ({ type: 'analysis/progress' } & Progress)
  | { type: 'graph/micro'; blockId: string; files: WebviewMicroFileNode[]; edges: MicroFileEdge[] }
  // A micro request can fail (no cache yet, a stale blockId) in a way that's local to the
  // block the user just dove into, not the whole panel — surfaced as its own message instead
  // of vscode.window.showErrorMessage (unlike a macro analysis failure) so the webview can
  // show an inline notice and fall back to the macro view, rather than being left in a
  // perpetual "diving in…" transition with no way back for itself.
  | { type: 'graph/micro/error'; blockId: string; message: string };

export type WebviewMessage =
  | { type: 'webview/ready'; generation: string }
  | { type: 'open/file'; fileId: string; line?: number }
  | { type: 'open/diff'; fileId: string }
  | { type: 'layout/persist'; positions: Record<string, Position>; edgeWaypoints: Record<string, Position[]> }
  // File-level drag parity (ROADMAP-V2.md) — a separate message type from `layout/persist`
  // above, not two more fields bolted onto it: camera-store.ts's macro instance (BlockCanvas)
  // and its file instance (GraphView, spanning every dive) are two independent hooks with two
  // independent debounce timers, each owning a disjoint pair of workspaceState keys — a
  // shared message shape would force one instance's persist to always carry the OTHER
  // instance's current value too (or make every field optional and push "which fields are
  // actually present" ambiguity onto every consumer), for no benefit: the two view-state
  // domains never need to be written atomically together.
  | { type: 'layout/file-persist'; filePositions: Record<string, Position>; fileEdgeWaypoints: Record<string, Position[]> }
  | { type: 'graph/micro/request'; blockId: string };
