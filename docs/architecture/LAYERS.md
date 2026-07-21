# Architecture — Layers

Six layers, strictly bottom-up. A layer only ever imports from a layer below it. This is
literal — each layer is a directory, not a metaphor.

```mermaid
flowchart TB
    subgraph L0["Layer 0 — External tools"]
        direction LR
        L0a["dependency-cruiser"]
        L0b["Node fs / child_process"]
        L0c["git (VS Code API)"]
    end
    subgraph L1["Layer 1 — core/src: pure analysis"]
        direction LR
        L1a["blocks/"]
        L1b["edges/"]
        L1c["risks/"]
        L1d["cache/"]
    end
    subgraph L2["Layer 2 — core/src: orchestration + process entrypoints"]
        direction LR
        L2a["analyze.ts"]
        L2b["cli.ts"]
        L2c["ipc-worker.ts"]
    end
    subgraph L3["Layer 3 — extension/src: process + cache lifecycle (vscode-free)"]
        direction LR
        L3a["analysis-runner.ts"]
        L3b["cache-bridge.ts"]
        L3c["change-buffer.ts"]
        L3d["webview-html.ts"]
        L3e["state.ts"]
        L3g["dirty-blocks.ts"]
    end
    subgraph L3b_["Layer 3b — extension/src/watcher.ts (imports vscode — the one exception)"]
        direction LR
        L3f["watcher.ts"]
    end
    subgraph L4["Layer 4 — extension/src: VS Code host glue"]
        direction LR
        L4a["extension.ts"]
        L4b["panel.ts"]
        L4c["commands/"]
        L4d["shared/protocol.ts"]
        L4f["git.ts"]
    end
    subgraph L5["Layer 5 — extension/webview/src: pure renderer"]
        direction LR
        L5a["flow/"]
        L5b["ui/"]
        L5c["fixtures/"]
        L5d["host-bridge.ts"]
        L5e["camera-store.ts"]
    end

    L0 --> L1 --> L2 --> L3 --> L3b_ --> L4 --> L5
```

| Layer | Directory | `vscode` import? | Package | Fully clears at |
|---|---|---|---|---|
| 0 | npm deps | n/a | — | — |
| 1 | `core/src/{blocks,edges,risks,cache}` | **No** — enforced by `core/test/no-vscode-import.test.ts` | `@blocknet/core` | Checkpoint B (`blocks/`, `edges/` truth validated earlier at Checkpoint A; `risks/`, `cache/` are built after A, in Tasks 4–5) |
| 2 | `core/src/{analyze,cli,ipc-worker}.ts` | **No** | `@blocknet/core` | `analyze.ts`/`cli.ts` at Checkpoint B; `ipc-worker.ts` ships with Task 6, alongside `analysis-runner.ts` (`docs/planning/PROGRESS.md`) |
| 3 | `extension/src/{analysis-runner,cache-bridge,change-buffer,webview-html,state,dirty-blocks}.ts` | **No** — deliberately kept vscode-free (unlike this table originally assumed) so the fork lifecycle, generation-id bookkeeping, debounce-classification, built-HTML transformation, workspaceState read/write, and dirty-block path-prefix logic are all unit-testable headlessly, same posture as Layers 1–2. `webview-html.ts` (Task 7) takes `panel.ts`'s vscode-derived strings as plain parameters rather than the `vscode.Webview` object itself; `state.ts` (Task 8) takes a narrow `WorkspaceMemento` structural type (the two methods it actually calls) rather than importing `vscode.Memento`, the exact pattern `cache-bridge.ts` already established for `context.storageUri` — this table originally placed `state.ts` in Layer 4 before it was built; built this way instead, deliberately, once it turned out to need nothing `vscode`-specific. `dirty-blocks.ts` (Task 9) is `git.ts`'s pure aggregation logic split into its own file specifically so it stays unit-tested even though `git.ts` itself (Layer 4, below) can't be | `@blocknet/extension` | Task 6 for the first three (`docs/planning/PROGRESS.md`); `webview-html.ts` ships with Task 7; `state.ts` ships with Task 8; `dirty-blocks.ts` ships with Task 9 |
| 3b | `extension/src/watcher.ts` | Yes — the thin `FileWatcher` shell wiring `vscode.workspace.createFileSystemWatcher` into `change-buffer.ts`; not unit-tested, verified manually via F5 | `@blocknet/extension` | Task 6 |
| 4 | `extension/src/{extension,panel,git}.ts`, `commands/{show-architecture,open-file}.ts` | Yes | `@blocknet/extension` | Task 6 ships the first three; `git.ts` and `commands/open-file.ts` ship with Task 9 (also no unit tests — same posture as `watcher.ts`, verified manually) — full layer clears at Checkpoint C |
| 5 | `extension/webview/src/**` | **No** — `host-bridge.ts` (Task 8) calls the global `acquireVsCodeApi()` (declared via `declare global`, not a `vscode` import) — a structural, not nominal, boundary: the layer still imports zero symbols from the `vscode` module, only from `extension/src/shared/protocol.ts` (a relative cross-boundary import, confirmed to resolve through both vite and vitest) | `@blocknet/webview` — its own npm workspace/package (unlike this table originally assumed under `@blocknet/extension`), own `vite build`, consumed by `panel.ts` as a built artifact under `extension/webview/dist/` | Checkpoint C — `open/file` ships with Task 9 (`RiskPopover`'s evidence links); `open/diff` stays unimplemented on both sides, deferred to `ROADMAP-V2.md`'s v2.0 micro view alongside block/file-level ⤢ |

## The rule this enforces

Layers 1–2 are `core` — headless, no VS Code, testable from the CLI alone. **Checkpoint A**
(after Task 3) is the go/no-go: blocks and edges must be proven true and fast on real repos
before anything else is built, including the rest of Layer 1 (risks, cache). **Checkpoint
B** (after Task 5) is Layer 1–2 fully complete and its schema frozen. Layers 3–5 (the
extension) do not start until Checkpoint B — "no UI before the truth gate" means the truth
gate must be *passed* (Checkpoint A) and the engine *finished* (Checkpoint B) before Layer 3
begins.

Nothing in Layer 3+ ever imports `core`'s `analyze()` and calls it in-process — see
[PROCESS-BOUNDARY.md](./PROCESS-BOUNDARY.md) for the enforced mechanism and why.
