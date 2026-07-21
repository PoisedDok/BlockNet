# Architecture — Webview Protocol

The webview is a **pure renderer of host state**. It owns only camera/UI state — never the
graph. Everything below crosses through `extension/src/shared/protocol.ts`, designed to be
imported verbatim by both the extension host and the webview so a payload shape cannot drift
between the two sides — there is only one type for it. As of Task 7, the extension host
imports it (`panel.ts`'s `post()`); the webview doesn't yet — Task 7 built the real React
Flow macro graph against static fixture data (`docs/planning/TASKS-V1.md`), deliberately not
against this contract, and Task 8 is what wires `postMessage` on the webview side.

## Messages

| Direction | Message | Payload |
|---|---|---|
| Host → Webview | `graph/macro` | `{ nodes: BlockNode[], edges: Edge[] }` |
| Host → Webview | `risks/update` | `{ risks: Risk[] }` |
| Host → Webview | `layout/restore` | `{ positions: Record<string,{x,y}> }` |
| Host → Webview | `analysis/progress` | `{ phase, done, total }` (from `Progress`) |
| Webview → Host | `open/file` | `{ fileId, line? }` → `showTextDocument` (ViewColumn.Beside) |
| Webview → Host | `open/diff` | `{ fileId }` → `vscode.diff` working-tree vs HEAD |
| Webview → Host | `layout/persist` | `{ positions }` |

## Ordering guarantee

On panel creation, `layout/restore` is always sent **before** `graph/macro`, so the first
paint has persisted positions available and never flashes a default layout that then jumps.
**Not yet implemented as of Task 7** — no code path posts `layout/restore` today; it depends
on `state.ts`'s persisted-positions store, which is Task 8's job
(`docs/architecture/DIRECTORY-TREE.md`). This is the binding requirement Task 8's
implementation must satisfy, not a description of current behavior.

## Why one file, not two

If `extension/src/protocol.ts` and `extension/webview/src/protocol.ts` each declared their
own copy of `HostMessage` / `WebviewMessage`, a change to one side's payload could silently
stop matching the other — a bug that only surfaces at runtime, never at compile time.
`shared/protocol.ts` is set up so both build targets *can* include it (esbuild for the host,
vite for the webview — both bundlers resolve relative imports across the `extension/`
directory boundary without any workspace-package indirection), so a payload change becomes a
compile error on both sides at once once Task 8 actually imports it from `webview/src/**`.
