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
| 2 | `core/src/{analyze,cli,ipc-worker}.ts` | **No** | `@blocknet/core` | Checkpoint B (`ipc-worker.ts` ships with Task 5) |
| 3 | `extension/src/{analysis-runner,cache-bridge,watcher}.ts` | Yes | `@blocknet/extension` | Checkpoint C |
| 4 | `extension/src/{extension,panel,commands}.ts`, `state.ts`, `git.ts` | Yes | `@blocknet/extension` | Checkpoint C |
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
