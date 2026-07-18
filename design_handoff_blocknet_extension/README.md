# Handoff: BlockNet — Architecture-First VS Code / Cursor Extension

## Overview
BlockNet is an **architecture-first code companion** that runs as a VS Code / Cursor extension. Where a normal AI IDE treats the *text buffer* as the primitive (you edit files; architecture lives in your head), BlockNet treats the **architecture graph** as the primitive: systems and their connections are drawn, clickable, and continuously checked for structural risk (circular dependencies, layer/boundary violations, secrets crossing into client bundles, etc.). Code is a detail you zoom into.

The extension's job is to sit *beside* the editor as a companion Webview: it renders the live dependency graph of the workspace, lets you click any node/edge to inspect it, flags structural problems, and pipes the selected architecture context into an AI chat participant. Editing, diffing, git history, and file opening are **delegated to native VS Code** — BlockNet does not reimplement them.

---

## ⚠️ Read this before writing any code — the single most important instruction

**The bundled `BlockNet.dc.html` is a DESIGN REFERENCE, not the extension architecture.**

It is an HTML prototype that fakes an entire IDE inside one canvas — a hand-rolled code editor, a hand-rolled git-history stepper, a hand-rolled diff view, a hand-rolled file "fullscreen" editor. **That was necessary to demo the concept in a browser. It is the WRONG architecture for a real extension.** Inside VS Code / Cursor you already have a best-in-class editor, diff viewer, git Timeline, and SCM panel. Reimplementing them in a webview would be fighting the host and would ship a worse editor than the one it's embedded in.

So when you implement this:

- **KEEP** (this is the product, the part Cursor doesn't have): the architecture **graph canvas**, the macro↔micro zoom, **output→input port routing**, the **connection inspector** (source↔target side-by-side), **risk detection + badges**, the **command palette that flies the camera to a node**, and the **"click a node/edge → it becomes AI chat context"** model.
- **DELEGATE TO NATIVE VS CODE** (do NOT rebuild in the webview): opening/editing files, syntax highlighting inside the editor, the git-history version stepper, the diff view, commit UX, and the "fullscreen file editor." The ⤢ "open in editor" affordance must call `vscode.window.showTextDocument()` and open the REAL editor. The version stepper becomes the native **Timeline** view; the diff becomes `vscode.diff`.

If you find yourself building a `<textarea>` code editor or a line-diff renderer, stop — you are copying the prototype's demo scaffolding instead of using the host.

---

## Fidelity
**High-fidelity** for the graph/inspector/palette/copilot surface. Colors, typography, spacing, port geometry, risk styling, and interactions in the prototype are the intended final look for the Webview. Recreate that surface faithfully in the webview's React app.

**Not applicable / discard** for the editor, diff, history-stepper, and fullscreen-file surfaces — those are placeholders for native VS Code features (see above).

---

## Target architecture (how the prototype maps to a real extension)

A VS Code extension has two runtimes. Split the prototype across them:

### 1. Extension Host (Node.js — `src/extension.ts` and modules)
The "engine." Has filesystem + workspace + git access. Responsible for:
- **Building the real dependency graph** of the open workspace (see *Graph Engine* below).
- **Running structural-risk checks** over that graph.
- Resolving a graph node/edge to real file paths + line ranges.
- Opening editors, diffs, and the Timeline on request.
- Hosting/relaying the AI chat participant.
- Persisting node positions (see *State* below).

### 2. Webview (React app — `webview/` built with esbuild/vite, loaded via `vscode.window.createWebviewPanel` or a `WebviewViewProvider` in the sidebar)
The "canvas." No filesystem access — it only knows what the host sends it. Responsible for:
- Rendering the macro (system) and micro (file) graphs, edges with output→input ports, risk badges.
- Pan/zoom camera, node drag, macro↔micro transition.
- The connection inspector, the command palette, and the Copilot chat UI shell.
- Emitting user intents to the host via `postMessage`.

### 3. The bridge (`postMessage` protocol)
Define a typed message protocol both ways. Suggested messages:

**Host → Webview**
- `graph/macro` — `{ nodes: SystemNode[], edges: Edge[] }`
- `graph/micro` — `{ system: string, files: FileNode[], edges: Edge[] }`
- `risks/update` — `{ risks: Risk[] }`
- `layout/restore` — `{ positions: Record<string,{x,y}> }`
- `chat/message` — streamed assistant tokens/messages

**Webview → Host**
- `open/file` — `{ fileId }` → host runs `showTextDocument`
- `open/diff` — `{ fileId }` → host runs `vscode.diff` (working tree vs HEAD)
- `open/timeline` — `{ fileId }` → host reveals Timeline
- `inspect/edge` — `{ edgeId }` → host returns both endpoints' code + ranges (for the inspector)
- `chat/ask` — `{ refs: Ref[], prompt }` → host forwards to the language model with the referenced files/ranges as context
- `layout/persist` — `{ positions }`
- `nav/fly` — `{ kind, id }` (palette selection; host may also `revealInExplorer`)

Keep the webview a **pure renderer of host state** — it should not hold the source of truth for the graph, only for camera/UI state.

---

## Graph Engine (the core differentiator — build this first)

Run in the host. Recommended library: **`ts-morph`** (wraps the TypeScript compiler API) for TS/JS projects; design the engine so the language backend is pluggable.

### Node model
- **System node (macro):** a logical service/package/app. Derive from workspace layout — top-level folders under `apps/`, `services/`, `packages/`, `infra/`, or `package.json` workspace members / tsconfig project references. Each system has: `id`, `name`, `path`, detected tech `pills` (from dependencies), and an aggregate risk count.
- **File node (micro):** an individual module inside a system. Has `id`, `name`, `path`, `pills`, `loc` (real line count), and per-file risk flags.

### Edge model
A directed dependency `A → B` derived from real `import`/`require`/dynamic-import statements (and, where feasible, SQL/queue/HTTP client usage for infra edges). `{ id, source, target, kind, risk? }`. **Edges render leaving the source's right edge (output) and entering the target's left edge (input)** — preserve this convention from the prototype.

### Risk checks (port these from the prototype's mock data as REAL analyses)
The prototype hardcodes these; implement them as graph queries:
1. **CIRCULAR** — cycle detection over the import graph (Tarjan/DFS). Flag every edge in a strongly-connected component with >1 node. Fix hint: extract shared contract into a third package.
2. **DIRECT DB / secret-in-client** — a module reachable from a client/browser entry (e.g. anything under `apps/web` client components) that imports a DB driver (`pg`, `mysql`, etc.) or reads a secret env var at module scope. Fix hint: move behind an API boundary.
3. **BOUNDARY** — a module in service A imports internals of service B directly (crossing a deployable boundary) rather than a shared package. Fix hint: give each service its own instance or share via a `packages/*` module.

Each risk carries: `{ tag, oneLine, explain, fix, source, target|file }` — exactly the shape the inspector and Copilot already consume.

### Incremental updates
Watch the workspace (`vscode.workspace.createFileSystemWatcher`) and re-run affected parts of the graph on save, pushing `graph/*` and `risks/update` to the webview.

---

## Screens / Views (Webview surface — recreate faithfully)

### View 1 — Macro map ("System Map")
- **Purpose:** see all systems and their connections; spot structural risk at a glance.
- **Layout:** full-bleed dark canvas with a 26px dotted radial grid, pannable/zoomable. Top status bar (54px) with brand, breadcrumb, legend, and risk count. Zoom controls bottom-left. Copilot docked bottom-right (368px).
- **System card:** ~236px wide, `linear-gradient(180deg,#151519,#0f0f12)`, 1px border (`#26262b`, or `rgba(239,68,68,.42)` when it carries risk), 13px radius, 14–16px padding. Contains: a 10px rotated-square status dot, the name (Space Grotesk 600, 14.5px, `#f4f4f5`), a risk pill (`N× ⚠`) when applicable, the path (JetBrains Mono 11px, `#71717a`), tech pills (10px mono, `#0e0e11` bg, 20px radius), and a "double-click to dive in ↧" hint. Double-click opens the micro view for that system.
- **Edges:** cubic bezier from source right-port to target left-port; horizontal control points (`dx = max(52, |Δx|·0.5)`). Normal edges = white, 1.5px, dashed `2 6`, animated flow. Risk edges = red `#ef4444`, 1.9px, solid, pulsing, with a `!` badge at the midpoint. Small port circles at both endpoints.

### View 2 — Micro map (inside a system)
- **Purpose:** see the files of one system and their intra-system imports.
- **Layout:** same canvas; breadcrumb shows `System Map / <system>`; a "← zoom out to map" button top-left (hide it when a file is open in the editor).
- **File card:** ~260px, similar styling. Header row: status dot, filename (mono 600 13px), spacer, then a **⤢ "open in editor" button**, a **`<loc> LOC` badge**, an `● edited` marker (when the working tree differs from HEAD), and a `⚠ risk` pill. The ⤢ button and LOC badge are the key adds.
  - In the real extension: `⤢` → `showTextDocument`; `● edited` ← git dirty state; `LOC` ← real line count.
- Clicking a card selects it (highlights its `relatedSet` — direct neighbors) **and adds it as an AI context chip**. Double-click may still peek code inline, but "real work" happens by opening the native editor.

### View 3 — Connection Inspector (KEEP — this is unique)
- Triggered by clicking an edge. A docked panel (bottom, left of Copilot) titled "CONNECTION INSPECTOR" showing `source → target`, a risk tag + one-line summary when risky, and **both endpoint files side-by-side** with syntax highlighting and the relevant lines emphasized. An "Ask Copilot ↗" button forwards the connection to chat.
- In the real extension, the side-by-side can either be your own read-only rendering (fetched from the host with line ranges) or you can offer "Open both" → two editor columns. Keep the risk explanation + fix prominent.

### View 4 — Command Palette (KEEP)
- `⌘K` overlay (also a header button). Fuzzy-filters all systems + files. Selecting one **flies the camera** to that node (animated pan/zoom via a transient transition flag) and references it. In the extension, also consider bridging to VS Code's own quick-open where natural, but the camera-fly to the graph node is the point.

### View 5 — Copilot dock (KEEP the context model)
- Bottom-right panel. Shows the current **context as chips**: every clicked node/edge and every selected code range becomes an `@ <label>` chip with an ✕ to remove (risky refs render red). Multi-reference, Cursor-style. Suggestion chips adapt to whether the context has a flagged risk. Input + send.
- In the extension, wire this to the **Chat / Language Model API** (`vscode.chat.createChatParticipant`, `vscode.lm`) or your own model call. The chips define the context payload sent with the prompt. Keep the product stance visible in copy: *it flags and explains structural risk and stages changes; it does not silently rewrite code.*

---

## Interactions & Behavior
- **Pan:** pointer-drag on empty canvas. **Zoom:** wheel (cursor-anchored) + zoom controls; clamp `k` to `[0.3, 2.4]`.
- **Node drag:** pointer-drag a card; positions persist (host-side, per workspace).
- **Macro→micro:** double-click a system → brief scale-up on the clicked node, then cross-fade to the micro layer (opacity + scale, ~0.45–0.5s).
- **Select:** single click selects a node/edge, dims unrelated nodes/edges to ~0.1–0.16 opacity, and adds a context chip.
- **Camera fly:** palette selection animates the camera (transient `transition: transform .5s cubic-bezier(.4,0,.2,1)`, cleared after ~560ms so dragging stays snappy).
- **Open in editor (⤢):** → native `showTextDocument`.
- **Risk edge pulse:** `@keyframes` opacity 0.5↔1, 1.7s.
- **Data-flow dash:** `@keyframes` `stroke-dashoffset` animation on normal edges.

## State Management
**Webview-owned (UI only):** camera per view (`{x,y,k}` for macro + micro), current view (`macro`|`micro`), active system, current selection, expanded/inspected ids, palette open+query, context refs, copilot open/draft.
**Host-owned (source of truth):** the graph (nodes/edges), risks, real file contents + line counts, git dirty/history state, and **persisted node positions** (use `context.workspaceState` keyed by workspace + node id). On webview mount, host sends `graph/*`, `risks/update`, and `layout/restore`.

## Design Tokens
- **Background:** `#08080a`; panel gradients `#151519→#0f0f12` (macro), `#141418→#0e0e11` (micro); inspector/copilot `#0c0c0f`; code bg `#060608`.
- **Borders:** `#26262b` (default), `#1c1c21` / `#141418` (dividers), `#2a2a30` (inputs), selected `#5b5b66`, referenced `rgba(244,244,245,.45)`.
- **Text:** `#fafafa`/`#f4f4f5` (primary), `#e4e4e7`/`#d4d4d8` (body), `#a1a1aa` (muted), `#71717a`/`#52525b`/`#3f3f46` (faint).
- **Risk red:** `#ef4444` / `#f87171`; tints `rgba(239,68,68,.06–.12)`.
- **Diff (only if you render your own read-only diff):** add `#86c79a` on `rgba(96,168,120,.12)`, del `#f0888a` on `rgba(239,68,68,.11)`.
- **Edited marker amber:** `#e0b464`.
- **Radii:** 5–7px (chips/controls), 12–14px (cards/panels).
- **Type:** Space Grotesk (UI, 400–700) + JetBrains Mono (code/labels/pills, 400–600). Substitute VS Code's font settings for the *editor* itself; keep these two for the webview chrome.
- **Grid:** 26px dotted radial, opacity ~0.55.

## Assets
No image assets. The brand mark is a 15px CSS rotated square. Icons are Unicode glyphs (`⤢ ◀ ▶ ✕ ↧ ⚠ ⌘`). No external assets to bundle beyond the two Google fonts (self-host them in the webview for offline use / CSP).

## Files in this bundle
- `BlockNet.dc.html` — the full interactive design reference (graph, inspector, palette, copilot, and the *placeholder* editor/history/diff to discard). Open it in a browser to study look and interactions.
- `support.js` — the tiny runtime that powers the `.dc.html` prototype. **Reference only — not part of the extension.** Do not port it.

---

## Suggested build order (for Claude Code)
1. **Scaffold:** `npx --package yo --package generator-code -- yo code` → TypeScript extension. Add an esbuild/vite build for the `webview/` React app. Set a strict webview CSP; self-host fonts.
2. **Graph engine (host):** with `ts-morph`, build the system + file graph and edges from a sample monorepo. Unit-test cycle detection and the boundary/direct-DB checks. This is the core — get it right before any UI.
3. **Webview shell:** port the macro/micro canvas, cards, output→input edges, pan/zoom, and macro↔micro transition from the prototype. Feed it static fixture data first.
4. **Bridge:** implement the `postMessage` protocol; replace fixtures with live `graph/*` + `risks/update` from the host. Persist positions in `workspaceState`.
5. **Native delegation:** wire ⤢ → `showTextDocument`, dirty state → git API, add "Open diff" (`vscode.diff`) and "Open Timeline". Delete any temptation to render your own editor.
6. **Inspector + palette:** edge click → host returns endpoint ranges → render side-by-side; `⌘K` fuzzy → camera fly.
7. **Chat participant:** register with the Chat/LM API; send the context chips (files + ranges) as grounding; stream replies into the Copilot dock. Keep the "explain & stage, never silently rewrite" stance.
8. **Package:** `vsce package` → `.vsix`. Installs in both VS Code and Cursor.

## Deferred / future (noted in prototype, decide later)
Multi-file AI diff-review (accept/reject per hunk — high value given the structural-edit angle; in-extension this = a `WorkspaceEdit` preview), blame-on-line, keyboard-only graph navigation, and language backends beyond TS/JS.
