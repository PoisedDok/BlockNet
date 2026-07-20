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
    subgraph L3["Layer 3 — extension/src: process + cache lifecycle"]
        direction LR
        L3a["analysis-runner.ts"]
        L3b["cache-bridge.ts"]
        L3c["watcher.ts"]
    end
    subgraph L4["Layer 4 — extension/src: VS Code host glue"]
        direction LR
        L4a["extension.ts"]
        L4b["panel.ts"]
        L4c["commands/"]
        L4d["shared/protocol.ts"]
        L4e["state.ts"]
        L4f["git.ts"]
    end
    subgraph L5["Layer 5 — extension/webview/src: pure renderer"]
        direction LR
        L5a["flow/"]
        L5b["state/"]
        L5c["ui/"]
    end

    L0 --> L1 --> L2 --> L3 --> L4 --> L5
```

| Layer | Directory | `vscode` import? | Package | Fully clears at |
|---|---|---|---|---|
| 0 | npm deps | n/a | — | — |
| 1 | `core/src/{blocks,edges,risks,cache}` | **No** — enforced by `core/test/no-vscode-import.test.ts` | `@blocknet/core` | Checkpoint B (`blocks/`, `edges/` truth validated earlier at Checkpoint A; `risks/`, `cache/` are built after A, in Tasks 4–5) |
| 2 | `core/src/{analyze,cli,ipc-worker}.ts` | **No** | `@blocknet/core` | `analyze.ts`/`cli.ts` at Checkpoint B; `ipc-worker.ts` ships with Task 6, alongside `analysis-runner.ts` (`docs/planning/PROGRESS.md`) |
| 3 | `extension/src/{analysis-runner,cache-bridge,change-buffer}.ts` | **No** — deliberately kept vscode-free (unlike this table originally assumed) so the fork lifecycle, generation-id bookkeeping, and debounce-classification logic are unit-testable headlessly, same posture as Layers 1–2 | `@blocknet/extension` | Task 6 (`docs/planning/PROGRESS.md`) |
| 3b | `extension/src/watcher.ts` | Yes — the thin `FileWatcher` shell wiring `vscode.workspace.createFileSystemWatcher` into `change-buffer.ts`; not unit-tested, verified manually via F5 | `@blocknet/extension` | Task 6 |
| 4 | `extension/src/{extension,panel}.ts`, `commands/show-architecture.ts` | Yes | `@blocknet/extension` | Task 6 ships these three; `state.ts` (Task 8, workspaceState positions), `git.ts` and `commands/open-file.ts` (Task 9) land later — full layer clears at Checkpoint C |
| 5 | `extension/webview/src/**` | **No** — only `acquireVsCodeApi()` | `@blocknet/extension` (own build) | Checkpoint C |

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
