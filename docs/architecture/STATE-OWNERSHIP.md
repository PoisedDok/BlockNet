# Architecture — State Ownership

Who is allowed to hold which piece of state, exhaustively. This is what makes "the webview
is a pure renderer" ([PROTOCOL.md](./PROTOCOL.md)) enforceable rather than a suggestion.

| State | Owner | Lives in | Survives |
|---|---|---|---|
| Import truth (files, edges, risks) | `core` | Re-derived on every full `analyze()` call | Nothing — a full scan always trusts source over cache |
| Content-hash manifest | `core/cache` | JSON file under `context.storageUri` | Disk, across VS Code restarts |
| `GraphResult` snapshot (last known-good) | `core/cache` | JSON file under `context.storageUri`, alongside the manifest | Disk, across VS Code restarts — this is what makes a warm open instant |
| `GraphResult` (current, in-memory) | Extension host | In-memory in `extension.ts`, pushed to webview | One VS Code session (reloaded from the disk snapshot on restart, then delta-checked against the manifest) |
| Node positions | Extension host | `context.workspaceState` | Disk, across VS Code restarts, per-workspace |
| Camera (pan/zoom/selection) | Webview | `camera-store.ts`, in-memory | Nothing — resets on panel reload (positions do persist, see above) |
| Dirty-file (git) markers | Extension host | Queried live from the git API on each `graph/macro` push | Nothing — always fresh |

## The rule this enforces

The webview never receives raw file paths beyond what's needed to render
(`BlockNode.path`) and never talks to disk, git, or the child process directly — every one
of those crossings goes through
[`shared/protocol.ts`](../architecture/PROTOCOL.md).

## Multi-window safety

`context.storageUri` is scoped to the *workspace*, not the *window* — if a developer opens
the same repo in two VS Code windows, both extension hosts read and write the same manifest
and snapshot files independently, with no cross-process lock. This is accepted, not
overlooked, because both properties needed to make it safe already hold:

1. **No torn reads.** `cache/store.ts` never writes the manifest or snapshot in place — it
   writes to a temp file in the same directory and `fs.rename`s it into place, which is
   atomic on the same volume on both POSIX and NTFS. A reader always sees either the old
   file or the fully-written new one, never a partial write.
2. **Convergent, not conflicting, writes.** The manifest is a pure function of file
   contents (content hashes), so two windows racing on the same edit converge to the same
   (or an equally valid, if one window is a commit ahead) result — there is no scenario
   where window A's and window B's writes disagree in a way that corrupts state, only one
   where the slower window's write is redundant. Last-write-wins is therefore an acceptable
   resolution, not a gap.
