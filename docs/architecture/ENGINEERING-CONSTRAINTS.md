# Architecture — Engineering Constraints

Binding for every task, every layer. These aren't preferences — a violation here is a bug,
not a style nit.

- **Activate lazily.** `workspaceContains:**/tsconfig.json` (explicit in
  `activationEvents`) plus `onCommand:blocknet.showArchitecture` (VS Code auto-generates this
  one from `contributes.commands` as of the engines.vscode floor this extension targets —
  confirmed via the editor's own manifest lint while building Task 6, not declared
  redundantly). Never `"*"`.
- **Never block the extension host thread.** All analysis happens in a forked child
  process — see [PROCESS-BOUNDARY.md](./PROCESS-BOUNDARY.md). Typing must stay smooth
  during a cold scan.
- **Contribute, don't colonize.** Native VS Code surfaces first (commands, Timeline, diff,
  editor); the webview exists only for the graph canvas.
- **Respect the host theme.** Design tokens map onto `var(--vscode-*)` — see
  `extension/webview/src/theme/tokens.css`. Light, dark, and high-contrast all must render
  correctly; none is a special case handled separately.
- **One webview, disciplined.** Strict CSP, self-hosted fonts (no CDN — the CSP blocks it
  anyway), `postMessage` only, proper disposal on panel close.
- **Degrade gracefully.** No workspace, no git, a huge repo, a non-TS repo, or a **multi-root
  workspace** must render a friendly `EmptyState`, never an error toast, a crash, or a
  silent partial analysis. v1 analyzes exactly one workspace root
  (`AnalyzeOptions.rootDir` is singular by design, `docs/architecture/DATA-MODEL.md`) — a
  multi-root workspace is a named, visible unsupported state (`extension.ts` checks
  `vscode.workspace.workspaceFolders.length > 1` before analyzing), not an implicit
  first-folder-only behavior a developer would have to notice was wrong.

## The hard rule from the design handoff

If a task starts building a `<textarea>` editor, a line-diff renderer, or any git-history
UI inside the webview — stop. That is copying the design prototype's demo scaffolding
instead of delegating to the host. See
[decisions/0009](../decisions/0009-native-delegation-split-screen.md).
