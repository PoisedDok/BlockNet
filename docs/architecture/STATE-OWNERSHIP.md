# Architecture — State Ownership

Who is allowed to hold which piece of state, exhaustively. This is what makes "the webview
is a pure renderer" ([PROTOCOL.md](./PROTOCOL.md)) enforceable rather than a suggestion.

| State | Owner | Lives in | Survives |
|---|---|---|---|
| Import truth (files, edges, risks) | `core` | Re-derived on every full `analyze()` call | Nothing — a full scan always trusts source over cache |
| Content-hash manifest, `GraphResult` snapshot (last known-good), and the pre-aggregation `FileEdge[]` the delta path merges into | `core/cache` | ONE JSON file under `context.storageUri` (`cache/store.ts`), not three separate files — see below | Disk, across VS Code restarts — this is what makes a warm open instant, and what the content-changed delta path merges into |
| `GraphResult` (current, in-memory) | Extension host | In-memory in `extension.ts`, pushed to webview | One VS Code session (reloaded from the disk snapshot on restart, then delta-checked against the manifest) |
| Node positions (every item, every layer) | Extension host | `context.workspaceState` (`blocknet.positions`) — ONE flat map spanning blocks, plain folders, files, and doc stacks at every depth (v2.0.1's unified layer model, ROADMAP-V2.md's "State keying, generalized") | Disk, across VS Code restarts, per-workspace |
| Edge waypoints (every intra-layer edge, every layer) | Extension host | `context.workspaceState` (`blocknet.edgeWaypoints` — a separate key from node positions, `state.ts`) — ONE flat map, same scope as positions above | Disk, across VS Code restarts, per-workspace — identical sparse-override contract as node positions |
| Camera (pan/zoom/selection) | Webview | `camera-store.ts`, in-memory, ONE instance owned by `GraphView.tsx` for the panel's whole session | Nothing — resets on panel reload (positions do persist, see above); survives navigating away from and back to a layer within the same session, since `GraphView.tsx` (not the remounting `LayerCanvas`) owns the instance |
| Dirty-file (git) markers | Extension host | Queried live from the git API on each `graph/macro` push (`git.ts` + `dirty-blocks.ts`, Task 9) and each `graph/layer` push (`git.ts` + `dirty-blocks.ts` for folder items, exact-path membership for file items, any-constituent-file membership for doc stacks — v2.0.1) | Nothing — always fresh |
| Layer graph (items/edges/arrows) for the currently-viewed layer | Extension host, computed on demand | Never persisted — `analyze-layer.ts` recomputes from `core/cache`'s last macro snapshot on every `graph/layer/request` (v2.0.1, `ROADMAP-V2.md`) | Nothing — re-visiting the same layer always re-fetches, never serves a stale client-held copy (deliberate, not a gap — see PROTOCOL.md's process-boundary note) |
| Layer navigation state (the stack of visited layers, cross-fade phase) | Webview | `GraphView.tsx`, in-memory — an arbitrary-depth array of `{path, name}` entries, not a fixed macro/micro phase machine (v2.0.1 replaces the old two-level `'macro'\|'diving'\|'micro'` model with one uniform stack, since every layer — including layer 0 — is now reached and rendered identically) | Nothing — resets on panel reload, same posture as camera (pan/zoom/selection) above; a reload always restarts at layer 0 |

## The rule this enforces

The webview never receives raw file paths beyond what's needed to render (`BlockNode.path`,
`LayerItem`'s own `path`/`id` fields) and never talks to disk, git, or the child process
directly — every one of those crossings goes through
[`shared/protocol.ts`](../architecture/PROTOCOL.md).

## Multi-window safety

`context.storageUri` is scoped to the *workspace*, not the *window* — if a developer opens
the same repo in two VS Code windows, both extension hosts read and write the same cache
file independently, with no cross-process lock. This is accepted, not overlooked, because
all three properties needed to make it safe already hold:

1. **No torn reads.** `cache/store.ts` never writes in place — it writes a temp file in the
   same directory and `fs.rename`s it into place, which is atomic on the same volume on both
   POSIX and NTFS. A reader always sees either the old file or the fully-written new one,
   never a partial write.
2. **No torn *pairs* either — the manifest, snapshot, and FileEdge[] are one file, not
   three.** Atomic-per-file isn't sufficient on its own: if the manifest and snapshot were
   two separately-atomic files, a crash between the two writes could leave a newer manifest
   on disk paired with a stale snapshot. `cache/invalidate.ts` would then diff the fresh
   current state against that already-updated manifest, see no difference, and conclude
   "unchanged" — silently serving the stale snapshot forever. Writing all three as a single
   JSON blob makes that interleaving structurally impossible: a reader only ever observes
   the fully-old state or the fully-new one, never a mix.
3. **Convergent, not conflicting, writes.** The manifest is a pure function of file
   contents (content hashes), so two windows racing on the same edit converge to the same
   (or an equally valid, if one window is a commit ahead) result — there is no scenario
   where window A's and window B's writes disagree in a way that corrupts state, only one
   where the slower window's write is redundant. Last-write-wins is therefore an acceptable
   resolution, not a gap.
