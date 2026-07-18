# ADR-0009: Open-in-editor is always native, split screen

## Status
Accepted

## Date
2026-07-10

## Context
The design handoff prototype includes demo scaffolding for an in-webview editor and diff
view. VS Code already has both, natively, better than anything BlockNet could build in a
webview iframe.

## Decision
The ⤢ affordance calls
`vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside })` — the graph
panel stays put, code opens in the adjacent column (the Claude Code pattern). Diff uses
`vscode.diff`; history uses the native Timeline view.

## Alternatives Considered

### Webview-embedded editor/diff (as prototyped in the design handoff)
- Pros: full visual control, matches the prototype's demo pixel-for-pixel.
- Rejected: rebuilds a strictly worse editor and diff viewer than the one already running
  the extension host process. This is explicitly called out as the trap to avoid — see
  `docs/architecture/ENGINEERING-CONSTRAINTS.md` ("the hard rule from the design handoff").

## Consequences
Every "click through to code" interaction in the webview is a `postMessage` to
`extension/src/commands/open-file.ts`, never a rendered editor surface
(`docs/architecture/PROTOCOL.md`, `open/file` / `open/diff`). Git dirty state surfaces as an
`● edited` marker on blocks containing dirty files, read live from the git API — never
duplicated into BlockNet's own state.
