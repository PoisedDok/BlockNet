# Architecture — Webview Protocol

The webview is a **pure renderer of host state**. It owns only camera/UI state — never the
graph. Everything below crosses through `extension/src/shared/protocol.ts`, designed to be
imported verbatim by both the extension host and the webview so a payload shape cannot drift
between the two sides — there is only one type for it. Both sides import it as of Task 8: the
extension host (`panel.ts`'s `post()`/`onDidReceiveMessage`) since Task 6, and the webview
(`extension/webview/src/host-bridge.ts`) since Task 8 — a relative cross-boundary import, no
workspace-package indirection, confirmed to resolve correctly through both esbuild (host) and
vite (webview), including through vitest's own transform pipeline for tests.

## Messages

| Direction | Message | Payload |
|---|---|---|
| Host → Webview | `graph/macro` | `{ nodes: WebviewBlockNode[], edges: Edge[] }` |
| Host → Webview | `risks/update` | `{ risks: Risk[] }` |
| Host → Webview | `layout/restore` | `{ positions: Record<string,{x,y}> }` |
| Host → Webview | `analysis/progress` | `{ phase, done, total }` (from `Progress`) |
| Webview → Host | `webview/ready` | *(none)* — see "The ready handshake" below |
| Webview → Host | `open/file` | `{ fileId, line? }` → `showTextDocument` (ViewColumn.Beside) |
| Webview → Host | `open/diff` | `{ fileId }` → `vscode.diff` working-tree vs HEAD |
| Webview → Host | `layout/persist` | `{ positions }` |

`risks/update` is sent by `commands/show-architecture.ts` alongside `graph/macro` but not
currently consumed by the webview — every risk the UI shows (StatusBar's count, `RiskPopover`)
already comes from `graph/macro`'s own `Edge.risk`, the identical `Risk` objects `risks/update`
would otherwise duplicate. It stays part of the contract (and the host keeps sending it) as
the natural home for a future dedicated risks-list view (`docs/planning/ROADMAP-V2.md`), not
dead protocol — `App.tsx`'s message switch has an explicit no-op case for it, not a silent
drop.

`graph/macro`'s `nodes` are `WebviewBlockNode` (`shared/protocol.ts`: `BlockNode & { dirty:
boolean }`), not core's own `BlockNode` directly — dirty-file state is an extension-host-only
concern (`STATE-OWNERSHIP.md`, `git.ts` + `dirty-blocks.ts`, Task 9) computed fresh on every
push, never something core's frozen Checkpoint-B schema knows about. `commands/show-
architecture.ts`'s `triggerAnalysis` is the one place a plain `BlockNode` gains the field, right
before posting.

`open/file` is implemented on both sides as of Task 9: `RiskPopover`'s evidence `file:line`
entries post it (`extension/webview/src/ui/RiskPopover.tsx`), and `commands/open-file.ts`
handles it host-side. `open/diff` stays defined in the protocol but unimplemented on both
sides — it has no v1 UI trigger. A block-card ⤢ was TASKS-V1.md's original plan for both, but
a block is always a directory (`BlockNode.path`), never a single file, so there's no canonical
file for a block-level ⤢ (or the diff it would trigger) to target without a drill-down step v1
doesn't have. Both are deferred to `ROADMAP-V2.md`'s v2.0 micro view, where each card is a
single file and the target is unambiguous (confirmed against the design-handoff prototype:
its ⤢ affordance only ever exists on file-level cards, never block-level ones).

## The ready handshake

VS Code drops any `postMessage` sent before the webview's own
`window.addEventListener('message', ...)` has registered — there is no queue, and a message
sent too early is simply gone. `panel.ts` reassigns `webview.html` on every
`createOrReveal('ready', ...)` call (construction **and** reveal — this doesn't special-case
"already showing this state," so every call is a fresh navigation, a fresh script instance,
and a fresh listener-registration race), so the host cannot assume any fixed delay is safe.

The webview's `App.tsx` posts `webview/ready` as the first thing it does after subscribing to
`window.addEventListener('message', ...)` — before that, it does nothing else. `panel.ts`'s
`whenReady(): Promise<void>` resolves the first time it observes `webview/ready` on the current
webview instance; `commands/show-architecture.ts` awaits it before posting anything.
`'no-workspace'`/`'multi-root'` panel states never resolve `whenReady()` (`enableScripts:
false` — no script ever runs to post it), so this handshake only applies to the `'ready'`
state.

## Ordering guarantee

On panel creation, `layout/restore` is always sent **before** `graph/macro`, gated on the
ready handshake above, so the first paint has persisted positions available and never flashes
a default layout that then jumps. Implemented in `commands/show-architecture.ts`:
`panel.whenReady().then(() => { panel.post({type: 'layout/restore', ...}); triggerAnalysis(...) })`.
Positions come from `state.ts`'s `getPositions()` (`context.workspaceState`) — a sparse map of
only the ids a user has actually moved or previously restored, never a full snapshot of
`layout.ts`'s dagre output (see `layout.ts`'s own header comment for why that distinction is
load-bearing, not cosmetic).

## Why one file, not two

If `extension/src/protocol.ts` and `extension/webview/src/protocol.ts` each declared their
own copy of `HostMessage` / `WebviewMessage`, a change to one side's payload could silently
stop matching the other — a bug that only surfaces at runtime, never at compile time.
`shared/protocol.ts` is set up so both build targets include it (esbuild for the host, vite
for the webview — both bundlers resolve relative imports across the `extension/` directory
boundary without any workspace-package indirection), so a payload change is a compile error on
both sides at once — confirmed, not assumed: `layout.ts` also imports `Position` from here
rather than declaring its own structurally-identical duplicate, and both `tsc --noEmit` and
`vitest run` (which transforms through the same vite pipeline as the real build) pass clean.
