import type { BlockNode, Edge, Progress, Risk } from '@blocknet/core';

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

export type HostMessage =
  | { type: 'graph/macro'; nodes: WebviewBlockNode[]; edges: Edge[] }
  | { type: 'risks/update'; risks: Risk[] }
  | { type: 'layout/restore'; positions: Record<string, Position> }
  | ({ type: 'analysis/progress' } & Progress);

export type WebviewMessage =
  | { type: 'webview/ready'; generation: string }
  | { type: 'open/file'; fileId: string; line?: number }
  | { type: 'open/diff'; fileId: string }
  | { type: 'layout/persist'; positions: Record<string, Position> };
