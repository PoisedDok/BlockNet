# Architecture — Webview Protocol

The webview is a **pure renderer of host state**. It owns only camera/UI state — never the
graph. Everything below crosses through `extension/src/shared/protocol.ts`, imported
verbatim by both the extension host and the webview. A payload shape cannot drift between
the two sides because there is only one type for it.

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

## Why one file, not two

If `extension/src/protocol.ts` and `extension/webview/src/protocol.ts` each declared their
own copy of `HostMessage` / `WebviewMessage`, a change to one side's payload could silently
stop matching the other — a bug that only surfaces at runtime, never at compile time.
`shared/protocol.ts` is imported by both build targets (esbuild for the host, vite for the
webview both include it), so a payload change is a compile error on both sides at once.
