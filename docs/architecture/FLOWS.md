# Architecture — End-to-End Flows

Four flows cover every way data moves through the system. If a new feature needs a fifth,
it doesn't belong in v1 (check `docs/planning/ROADMAP-V2.md`).

## 1. Cold analyze (first time a repo is opened)

```mermaid
sequenceDiagram
    actor Dev
    participant VSC as VS Code
    participant Ext as extension.ts
    participant Panel as panel.ts
    participant Runner as analysis-runner.ts
    participant Worker as core: ipc-worker.ts (forked)
    participant WV as webview: App.tsx

    Dev->>VSC: Run "BlockNet: Show Architecture"
    VSC->>Ext: command fires
    Ext->>Panel: create/reveal WebviewPanel
    Panel->>WV: load html shell (CSP, fonts)
    Ext->>Runner: analyze(workspaceRoot)
    Runner->>Worker: fork + send({rootDir, cacheDir})
    Worker-->>Runner: progress(blocks, 1/4) ... (edges, 2/4) ... (risks, 3/4) ... (cache, 4/4)
    Runner-->>Panel: postMessage analysis/progress (×4)
    Panel-->>WV: analysis/progress
    WV->>WV: render ProgressBar
    Worker-->>Runner: result: GraphResult
    Runner->>Ext: GraphResult
    Ext->>Ext: state.ts: read persisted positions (none yet)
    Ext-->>Panel: postMessage graph/macro, risks/update
    Panel-->>WV: graph/macro, risks/update
    WV->>WV: graph-store hydrates; layout.ts computes initial dagre layout
    WV-->>Dev: BlockCanvas renders
```

## 2. Incremental re-analyze (developer saves a file)

```mermaid
sequenceDiagram
    actor Dev
    participant FS as Filesystem
    participant Watcher as watcher.ts
    participant Runner as analysis-runner.ts
    participant Worker as core: ipc-worker.ts (forked)
    participant Ext as extension.ts
    participant WV as webview

    Dev->>FS: save file.ts (× N within the debounce window)
    FS-->>Watcher: onDidChange (× N)
    Watcher->>Watcher: buffer changed paths, debounce ~500ms
    Watcher->>Runner: analyze(workspaceRoot, {changedFiles: [...buffered]})
    Runner->>Runner: assign generation id G, record as latest
    Runner->>Worker: fork + send({..., changedFiles})
    Worker->>Worker: cache/invalidate.ts scopes edge re-extraction to the\nchanged files' own edges + dependents' block edges;\nTarjan SCC re-runs on the full (cached+fresh) edge list — see decisions/0008
    Worker-->>Runner: result: GraphResult (delta, same shape as full), tagged G
    Runner->>Runner: if G is still the latest generation, forward;\nif a newer run superseded it, discard silently
    Runner->>Ext: GraphResult
    Ext-->>WV: postMessage graph/macro, risks/update
    WV->>WV: graph-store diff-merges by id; React re-renders\nonly the changed nodes/edges
```

### 2a. Why debounce + generation tagging, not a queue

`watcher.ts` coalesces file events into one buffered `changedFiles` set per ~500ms window
before triggering `analyze()` at all — an 8-file save (a formatter running across a
multi-file selection, a branch switch) becomes one run, not eight forked workers. If a
second trigger still manages to fire while a run is in flight (e.g. two edits straddle the
debounce boundary), `analysis-runner.ts` does not queue it behind the first — it forks a new
worker immediately and tags both runs with a monotonically increasing generation id. Only
the result whose generation matches the latest one issued is ever forwarded to the webview;
a slower, now-stale run's result is discarded on arrival. This guarantees the webview never
regresses to older data because an older analysis happened to finish last, without needing
any inter-process cancellation.

The config-change case (`tsconfig.json`, `package.json`) is not incremental —
`watcher.ts` detects it and calls `analyze()` **without** `changedFiles`, forcing the
full-scan path (still debounced and generation-tagged the same way). Same function, same
worker, different `AnalyzeOptions`.

**Implementation note (Task 5, 2026-07-19):** `analyze()` does not actually read
`changedFiles` — as built, `cache/invalidate.ts` re-derives the dirty set itself by diffing a
freshly-hashed `CacheManifest` against the previous one (docs/decisions/0008), rather than
trusting the caller's hint. The outcome this diagram describes (scoped re-extraction for a
content edit, full rescan for a config change) is what Task 5 actually produces either way;
`changedFiles` itself is currently unread and reserved for Task 6, which may or may not end
up wiring it as a perf optimization (skip hashing the full tree) once the watcher's real
behavior is known — an open question, not decided here.

## 3. Open-in-editor (⤢ affordance / risk evidence click)

```mermaid
sequenceDiagram
    actor Dev
    participant WV as webview: BlockNode / RiskPopover
    participant Panel as panel.ts
    participant Cmd as commands/open-file.ts
    participant VSC as VS Code editor

    Dev->>WV: click ⤢ on a block, or an evidence file:line
    WV->>Panel: postMessage open/file {fileId, line?}
    Panel->>Cmd: dispatch
    Cmd->>VSC: showTextDocument(uri, {viewColumn: Beside, selection})
    VSC-->>Dev: real editor opens beside the graph panel
    Note over WV,VSC: graph panel is untouched — never a webview-embedded editor
```

## 4. Layout persistence (drag a node)

```mermaid
sequenceDiagram
    actor Dev
    participant WV as webview: BlockCanvas
    participant Cam as camera-store.ts
    participant Panel as panel.ts
    participant State as state.ts

    Dev->>WV: drag a block card
    WV->>Cam: update position (optimistic, instant, local only)
    Cam->>Cam: debounce ~300ms
    Cam->>Panel: postMessage layout/persist {positions}
    Panel->>State: workspaceState.update(positions)
    Note over WV,State: on next panel open, panel.ts reads workspaceState and pushes\nlayout/restore BEFORE graph/macro — first paint has no flash
```
