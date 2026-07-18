# ADR-0001: Ship as a VS Code extension, not Tauri, not a webapp

## Status
Accepted

## Date
2026-07-10

## Context
BlockNet's thesis is "sit beside the editor" — the graph is only valuable if a developer
can look at it and their code in the same glance. We need to pick one distribution shape
before any code is written.

## Decision
Ship as a VS Code extension, distributed via the Marketplace and OpenVSX (so it also
installs in Cursor).

## Alternatives Considered

### Tauri (standalone desktop app)
- Pros: full control over UI shell; Rust performance headroom.
- Cons: forces rebuilding editor/diff/git UX from scratch to approximate "beside the
  editor" — exactly the trap the design handoff bans; loses free LSP access; slowest build.
- Rejected: Rust perf is irrelevant here — the bottleneck is import resolution and
  rendering, not the shell. All the cost, none of the benefit.

### Webapp ("paste a repo URL, see the graph")
- Pros: zero install, easy to demo, shareable link.
- Cons: no live workspace, can't sit beside a real editor — collapses into a picture, not a
  tool.
- Rejected for v1; kept as a v2+ marketing funnel (`docs/planning/ROADMAP-V2.md`) since
  `core` has zero VS Code dependencies and can run anywhere.

## Consequences
Native delegation (`showTextDocument`, `vscode.diff`, Timeline, git API) is free. LSP
becomes available later for cross-language drill-down. TypeScript throughout, with the
largest prior-art base of any of the three options.
