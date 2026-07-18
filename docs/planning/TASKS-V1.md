# Implementation Plan: BlockNet v1 — Architecture-First VS Code Extension

**Status:** Approved · **Date:** 2026-07-10 · **Owner:** Krish (krish@aetherinc.xyz)
**Companion doc:** [ROADMAP-V2.md](./ROADMAP-V2.md) — everything deferred, do not build any of it in v1.

---

## Overview

BlockNet v1 renders a TS/JS repository's **block-level architecture graph** — accurately and
fast — with **import cycles** and **one boundary violation rule** flagged, inside a VS Code
webview panel that sits beside the editor. Clicking through to code opens the **real** VS Code
editor in a **split column** (like Claude Code does), never a re-implemented editor.

**The one-sentence focus (if a feature is not in this sentence, it is not v1):**

> v1 = render a TS/JS repo's block-level architecture graph — accurately and fast — with
> import cycles and one boundary violation flagged, inside a VS Code webview.

### The thesis

Normal AI IDEs treat the *text buffer* as the primitive; architecture lives in your head.
BlockNet treats the **architecture graph** as the primitive. Linters (eslint/ruff/tsc) check
*code*; **nothing checks the map**. BlockNet is the aggregation layer that turns existing
analyzers' output into one navigable, spatial architecture — and (in v2) makes it
AI-addressable.

### The Gource lesson (why this is buildable)

The famous "repo as glowing nodes" video (Gource) is **layout physics over a filesystem
tree** — beautiful but architecturally *false* (edges are folder containment, not imports).
The two layers are independent:

| Layer | What | Difficulty |
|---|---|---|
| **Layout/beauty** | force-directed / React Flow rendering | Easy — commodity |
| **Data/truth** | real import edges + block clustering | Hard — this is the product |

Gource nailed layer 1 and skipped layer 2. BlockNet must nail layer 2; layer 1 comes nearly
free. **All effort goes to the engine.**

---

## Architecture Decisions (ADR-style — expensive to reverse, recorded with rationale)

### AD-1: Ship as a VS Code extension (not Tauri, not webapp)
- **Decision:** VS Code extension, distributed via Marketplace + OpenVSX (Cursor compatible).
- **Why:** The "sit beside the editor" thesis only holds inside the editor. Native delegation
  (`showTextDocument`, `vscode.diff`, Timeline, git API) is free. LSP is available later for
  cross-language. Fastest build (TS, huge prior art).
- **Rejected — Tauri:** standalone window forces rebuilding editor/diff/git (the exact trap
  the design handoff bans); loses free LSP; slowest build. Rust perf is irrelevant — the
  bottleneck is import resolution and rendering.
- **Rejected — Webapp:** no live workspace, can't sit beside the editor; collapses into a
  "paste a repo, get a picture" demo. Good as a v2+ marketing funnel, not the product.

### AD-2: Portable core — `core/` has zero VS Code dependencies
- **Decision:** Monorepo with `core/` (pure TS library + CLI, emits `graph.json`) and
  `extension/` (VS Code host + React webview) depending on `core/`.
- **Why:** All the value lives in the engine. Keeping it shell-free means the future webapp
  funnel (v2) reuses it unchanged, and it is testable headless from day one.

### AD-3: Engine = reuse dependency-cruiser; ts-morph deferred to v2
- **Decision:** v1 builds edges with **dependency-cruiser** (in-process AST parsing, resolves
  tsconfig `paths`, aliases, workspaces). We write the **aggregator**, not parsers.
  **ts-morph** enters in v2 for the file→function drill-down layer.
- **Why:** dep-cruiser already solves the genuinely hard part (import resolution across
  barrels/aliases/monorepos) plus ships a rule engine. Don't rebuild solved problems.
- **Explicitly NOT LSP:** LSP is RPC to a separate language-server process — designed for
  one-symbol-at-a-time interactive queries. Bulk graph-building = thousands of round-trips =
  minutes. LSP is reserved for v2 on-demand drill-down, never bulk indexing.

### AD-4: Languages — TS/JS only in v1
- **Decision:** TypeScript/JavaScript only. Python (ruff/pydeps) and multi-language-via-LSP
  are v2.
- **Why:** Nail one language's graph truthfully before generalizing. Best tooling exists here.

### AD-5: Blocks are auto-detected (zero config)
- **Decision:** Detection cascade:
  1. `package.json` workspaces / tsconfig project references (monorepos)
  2. Top-level `apps/` | `packages/` | `services/` | `libs/` | `infra/` folders
  3. Fallback for flat repos: top-level folders under `src/`
- **Why:** Zero-config preserves the 10-second first-run wow. Config-driven blocks
  (`blocknet.json` overrides) are a v2 refinement.
- **Known risk:** the flat-repo fallback may produce weak blocks; validate on real repos
  early (Task 3 checkpoint).

### AD-6: v1 risk checks = cycles + ONE boundary rule
- **Decision:**
  - **CIRCULAR:** Tarjan SCC over the import graph; flag every edge inside an SCC with >1
    node. Fix hint: extract shared contract into a third package.
  - **BOUNDARY (precisely defined to stay low-noise):** *a file in block A imports a **deep
    internal path** of block B (e.g. `packages/b/src/internal/x`) instead of B's declared
    entry (its `package.json` `main`/`exports`, or the block's `index.ts`).* Deep-import =
    violation; entry-import = fine.
- **Deferred:** DIRECT-DB / secret-reaches-client-bundle — that's reachability/taint
  analysis (noisy, hard). v2, via Semgrep first.
- **Why:** False positives kill trust instantly. Cycles have ~zero false positives; the
  boundary rule as defined is computable and defensible.

### AD-7: Render with React Flow (xyflow); blocks not clouds
- **Decision:** React Flow in the webview. Visual primitive = **block cards with
  output→input ports** (edges leave source's right edge, enter target's left edge — preserve
  the prototype convention), not organic force-directed "clouds".
- **Why:** Ports/edges/pan/zoom/drag/selection out of the box; matches the high-fidelity
  prototype (`design_handoff_blocknet_extension/BlockNet.dc.html`). Blocks are *legible*;
  clouds are pretty but unreadable at the architecture level. d3-force organic layout is a
  candidate for the v2 micro/file view only.

### AD-8: Caching & incrementality (the performance survival strategy)
- **Decision:** First import = full scan with **progress UI**. Result cached to a JSON file
  under `context.storageUri` keyed by a content-hash manifest (`workspaceState` holds only
  the manifest + node positions). Subsequent opens = instant load from cache + delta pass.
- **Invalidation rules (all three, not just content hashes):**
  1. File **content hash** change → re-analyze that file's edges **+** recompute the
     affected block's aggregate edges **+** re-check any SCC that file could belong to
     (cycles are semi-global; scope to the affected component, not the whole repo).
  2. File **add / delete / rename** (via `vscode.workspace.createFileSystemWatcher`).
  3. **Config change** (`tsconfig.json`, `package.json`, alias maps) → full cache bust.
- **Why:** Real repos are 5k–50k files; dep-cruiser can take 30s–2min cold. A frozen or
  minute-late graph gets uninstalled. Analysis runs in a **child process**, never on the
  extension host thread.

### AD-9: Open-in-editor = split screen, always native
- **Decision:** The ⤢ affordance calls `vscode.window.showTextDocument(uri,
  { viewColumn: vscode.ViewColumn.Beside })` — the graph panel stays put, code opens in the
  adjacent column (the Claude Code pattern). Diff = `vscode.diff`; history = native Timeline.
- **Hard rule from the design handoff:** if you find yourself building a `<textarea>` editor
  or a line-diff renderer in the webview, **stop** — you are copying the prototype's demo
  scaffolding instead of using the host.

### AD-10: Distribution — free OSS
- **Decision:** Free, open source, VS Code Marketplace + OpenVSX. No backend, no auth, no
  telemetry burden, no billing. Audience first; monetization is a later decision.

---

## VS Code extension principles (binding for all tasks)

- **Activate lazily** — on command / workspace-contains-tsconfig. Never `"*"`.
- **Never block the extension host thread** — heavy work in a child process.
- **Contribute, don't colonize** — native surfaces first; webview only for the canvas.
- **Respect the host theme** — map the prototype's dark tokens onto VS Code CSS variables so
  light/dark/high-contrast don't break.
- **One webview, disciplined** — strict CSP, self-hosted fonts (Space Grotesk + JetBrains
  Mono), postMessage only, proper disposal.
- **Degrade gracefully** — no workspace / no git / huge repo / non-TS repo must not crash.

### Webview message protocol (typed, both directions)

| Direction | Message | Payload |
|---|---|---|
| Host → Webview | `graph/macro` | `{ nodes: BlockNode[], edges: Edge[] }` |
| Host → Webview | `risks/update` | `{ risks: Risk[] }` |
| Host → Webview | `layout/restore` | `{ positions: Record<string,{x,y}> }` |
| Host → Webview | `analysis/progress` | `{ phase, done, total }` |
| Webview → Host | `open/file` | `{ fileId }` → `showTextDocument` (ViewColumn.Beside) |
| Webview → Host | `open/diff` | `{ fileId }` → `vscode.diff` working-tree vs HEAD |
| Webview → Host | `layout/persist` | `{ positions }` |

Webview is a **pure renderer of host state** — it owns only camera/UI state, never the graph.

### Data model

```ts
type BlockNode = { id: string; name: string; path: string; pills: string[];
                   fileCount: number; riskCount: number };
type Edge      = { id: string; source: string; target: string;
                   importCount: number; risk?: Risk };
type Risk      = { tag: 'CIRCULAR' | 'BOUNDARY'; oneLine: string; explain: string;
                   fix: string; source: string; target: string;
                   evidence: { file: string; line: number; statement: string }[] };
```

`Risk.evidence` carries the actual import statement + location so v2's connection inspector
consumes it unchanged.

---

## Repo layout

```
BlockNet/
├── docs/                 → this plan, PLAN-V2.md, future ADRs (docs/decisions/)
├── core/                 → @blocknet/core — pure TS lib + CLI. NO vscode imports.
│   ├── src/
│   │   ├── blocks.ts     → block auto-detection cascade (AD-5)
│   │   ├── edges.ts      → dependency-cruiser runner + edge aggregation to block level
│   │   ├── risks/
│   │   │   ├── cycles.ts     → Tarjan SCC
│   │   │   └── boundary.ts   → deep-import rule (AD-6)
│   │   ├── cache.ts      → hash manifest + incremental invalidation (AD-8)
│   │   └── cli.ts        → `blocknet analyze <path> --json`
│   └── test/             → unit tests incl. fixture monorepo + flat repo
├── extension/
│   ├── src/extension.ts  → activation, child-process runner, bridge, cache, delegation
│   └── webview/          → React + React Flow app (vite/esbuild), prototype tokens
└── design_handoff_blocknet_extension/   → design reference (KEEP surfaces only)
```

---

## Task List

### Phase 1: The Engine (headless — this is the whole ballgame)

#### Task 1: Scaffold monorepo + `core` package with CLI skeleton
**Description:** npm-workspaces monorepo; `core/` builds with tsup/tsc; `blocknet analyze
<path>` runs and emits an empty-but-valid `graph.json`; vitest wired.
**Acceptance criteria:**
- [ ] `npm run build && npx blocknet analyze .` emits schema-valid JSON
- [ ] `core/` has zero `vscode` imports (enforced by a lint rule or test)
**Verification:** `npm test` green; CLI runs on this repo.
**Dependencies:** None. **Scope:** S.

#### Task 2: Block auto-detection (AD-5 cascade)
**Description:** Implement workspaces → tsconfig refs → conventional folders → flat-`src/`
fallback. Emit `BlockNode[]` with tech pills derived from each block's dependencies.
**Acceptance criteria:**
- [ ] Fixture monorepo yields one block per workspace member
- [ ] Fixture flat repo yields blocks from top-level `src/` folders
- [ ] Tech pills reflect real deps (e.g. `react`, `pg`, `express`)
**Verification:** unit tests on both fixtures; CLI output inspected on one real repo.
**Dependencies:** Task 1. **Scope:** M.

#### Task 3: Edge extraction via dependency-cruiser + block aggregation
**Description:** Run dep-cruiser programmatically; resolve file→file import edges (tsconfig
paths, aliases, workspaces); map files→blocks; aggregate to block-level edges with
`importCount` and per-edge evidence (file, line, statement).
**Acceptance criteria:**
- [ ] File edges correct on fixture (incl. an aliased and a barrel import)
- [ ] Block edges = aggregation of crossing file edges, with counts
- [ ] Evidence array populated for every block edge
**Verification:** unit tests; run against a real Aether repo and manually spot-check 10 edges.
**Dependencies:** Task 2. **Scope:** M.

#### Checkpoint A — TRUTH GATE (the go/no-go for the whole product)
- [ ] Run `blocknet analyze` on **2–3 real repos** (Aether repos + one large OSS monorepo)
- [ ] Block graph is *true*: no phantom edges, no missing obvious edges (manual audit)
- [ ] Cold analysis time measured and recorded; acceptable with a progress bar (<~60s large)
- [ ] Flat-repo fallback produces *meaningful* blocks, not noise
- [ ] **Human review with Krish before Phase 2.** If truth fails here, fix the engine —
      do not proceed to UI. The demo dazzling on fixtures and disappointing on real repos
      is the project's #1 failure mode.

#### Task 4: Risk checks — cycles + boundary (AD-6)
**Description:** Tarjan SCC over the file graph, flag member edges, lift to block edges.
Boundary deep-import rule using each block's declared entry.
**Acceptance criteria:**
- [ ] Fixture with a 3-file cycle → exactly those edges flagged CIRCULAR, none others
- [ ] Deep-import fixture flagged BOUNDARY; entry-point import NOT flagged
- [ ] Each risk carries tag/oneLine/explain/fix/evidence
**Verification:** unit tests; zero false positives on the Checkpoint-A real repos.
**Dependencies:** Task 3. **Scope:** M.

#### Task 5: Cache + incremental invalidation (AD-8)
**Description:** Content-hash manifest; save/load full result; delta pass re-analyzing only
affected files + affected block edges + affected SCCs; full bust on config change.
**Acceptance criteria:**
- [ ] Second `analyze` on unchanged repo loads from cache (measured ≫ faster)
- [ ] Editing one file re-analyzes only it + dependents' edges (test asserts scope)
- [ ] Touching `tsconfig.json` busts the whole cache
**Verification:** unit tests with a temp-dir repo mutated between runs.
**Dependencies:** Task 4. **Scope:** M.

### Checkpoint B — Engine complete
- [ ] All core tests pass; CLI is honest, fast, incremental on real repos
- [ ] `graph.json` schema frozen for the webview

### Phase 2: The Extension Shell

#### Task 6: Extension host — activation, child process, progress, cache wiring
**Description:** Lazy activation (`BlockNet: Show Architecture` command +
workspace-contains-tsconfig). Spawn `core` in a child process; stream
`analysis/progress`; persist cache under `context.storageUri`; file watcher drives
incremental re-analysis on save/add/delete/rename.
**Acceptance criteria:**
- [ ] Extension host thread never blocks during analysis (typing stays smooth)
- [ ] Progress UI during first import; instant cache load on reopen
- [ ] Save of one file triggers scoped re-analysis and a `graph/macro` push
**Verification:** manual run on a real repo via F5 extension dev host.
**Dependencies:** Task 5. **Scope:** M.

#### Task 7: Webview — React Flow macro graph with prototype fidelity
**Description:** React app (vite/esbuild, strict CSP, self-hosted fonts). Block cards per
the design tokens (§Design Tokens of the handoff README): gradient cards, status dot, risk
pill (`N× ⚠`), path in mono, tech pills, connection-count badge. Edges: bezier
right-port→left-port, white dashed animated normal / red solid pulsing risk with `!`
midpoint badge. Pan/zoom (clamp k∈[0.3,2.4]), node drag, selection dims unrelated to
~0.1–0.16 opacity. Feed with **static fixture data first**.
**Acceptance criteria:**
- [ ] Visual parity with prototype macro view (side-by-side check)
- [ ] Pan/zoom/drag/select smooth at 30 blocks / 100 edges
- [ ] Works in light and dark host themes
**Verification:** manual against `BlockNet.dc.html`; theme toggle check.
**Dependencies:** Task 1 (schema only — parallelizable with Tasks 2–6). **Scope:** L
(pure rendering; split into card/edges/interactions commits).

#### Task 8: Bridge — live data + persisted layout
**Description:** Replace fixtures with live `graph/macro` + `risks/update`; implement
`layout/persist`/`layout/restore` via `workspaceState`; risk badge click shows the risk's
oneLine/explain/fix + evidence in a lightweight popover (not the full v2 inspector).
**Acceptance criteria:**
- [ ] Real repo renders live; save-edit round-trip updates the graph
- [ ] Node positions survive reload
- [ ] Risk popover shows real evidence (file:line import statement)
**Verification:** end-to-end manual flow on a real repo.
**Dependencies:** Tasks 6, 7. **Scope:** M.

#### Task 9: Native delegation — split-screen open, diff
**Description:** Block card ⤢ (and evidence file:line links) →
`showTextDocument({ viewColumn: ViewColumn.Beside, selection: range })` so BlockNet stays
open beside the code (Claude Code pattern). "Open diff" → `vscode.diff` working-tree vs
HEAD. Git dirty state → `● edited` amber marker on blocks containing dirty files.
**Acceptance criteria:**
- [ ] ⤢ opens the real editor in the adjacent column; graph panel remains visible
- [ ] Evidence link opens the file at the exact import line
- [ ] Dirty blocks show the amber marker
**Verification:** manual; confirm no webview-embedded editor anywhere.
**Dependencies:** Task 8. **Scope:** S.

### Checkpoint C — End-to-end
- [ ] Fresh clone → install vsix → open real repo → graph in seconds → red edges are true
      → click evidence → real editor at the real line, split screen
- [ ] The 3-second test: a stranger understands the repo's shape and its two worst
      structural problems without reading a file

### Phase 3: Ship

#### Task 10: Package & publish
**Description:** `vsce package`; Marketplace + OpenVSX publish; README with GIF of the
macro graph + risk flow; graceful-degradation pass (no workspace / no git / non-TS repo
show a friendly empty state).
**Acceptance criteria:**
- [ ] `.vsix` installs clean in both VS Code and Cursor
- [ ] All degraded states render a helpful message, never an error toast
**Verification:** install test in both editors; empty-folder test.
**Dependencies:** Checkpoint C. **Scope:** S.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Graph is wrong on real repos (phantom/missing edges) | **Fatal** | Checkpoint A truth gate on real repos before any UI; dep-cruiser (battle-tested resolution) instead of custom parsing |
| Analysis too slow / freezes editor on 5k–50k-file repos | **High** | Child process, progress UI, cache + incremental (AD-8), measure at Checkpoint A |
| Flat repos produce meaningless blocks | **High** | Fallback heuristic validated at Checkpoint A; `blocknet.json` override lands in v2 |
| Boundary rule false positives erode trust | **Med** | Narrow deep-import definition (AD-6); zero-FP bar at Task 4 verification |
| "Looked once, closed it" — no retention | **Med** | v1 is deliberately narrow; retention hooks (AI context, micro view) are v2 — ship, learn, then invest |
| Scope creep back toward the full prototype | **Med** | The one-sentence focus; PLAN-V2.md exists precisely so deferred ideas have a home |
| Prior art gravity (CodeSee shut down; IDE diagrams unused) | **Med** | Differentiator is *truthful risk detection + native delegation + (v2) AI context*, not the picture; validate with real users post-ship |

## Open Questions (fine to resolve during build)

- Sidebar `WebviewViewProvider` vs editor-area `WebviewPanel` for the canvas? (Leaning
  panel — the graph wants width; decide at Task 7.)
- Minimum block count to bother rendering (a 1-block repo has no architecture — show
  files instead? or the friendly empty state?)
- Whether `importCount` renders on the edge or the card badge (visual call at Task 7).

## What v1 deliberately does NOT do (see PLAN-V2.md)

No micro/file view, no connection inspector, no ⌘K palette, no AI/chat, no Python or
multi-language, no secret-reaches-client analysis, no function-level graph, no webapp.
Each has a design and a rationale already — in the v2 doc, where it stays until v1 ships.
