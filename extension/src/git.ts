import { relative } from 'node:path';
import { isWithinRoot } from '@blocknet/core/path-utils';
import * as vscode from 'vscode';

// Dirty-file (git) markers (docs/architecture/STATE-OWNERSHIP.md: "Queried live from the git
// API on each graph/macro push" — never cached, never duplicated into BlockNet's own state).
// Layer 4 (docs/architecture/LAYERS.md) — unlike state.ts/cache-bridge.ts's narrow structural
// types over vscode.Memento, there's no equivalent trick here: resolving the built-in git
// extension itself is only reachable through the real `vscode.extensions` namespace, not an
// injectable parameter, so this file is genuinely vscode-coupled, not just vscode-typed, and
// has no unit tests (same posture as watcher.ts/panel.ts/show-architecture.ts, verified
// manually instead). The actual bug-prone logic (path-prefix matching) lives in the separate,
// vscode-free dirty-blocks.ts specifically so IT stays unit-tested.

// @types/vscode does not ship the built-in git extension's own API surface — it's a
// separate, informally-typed extension API (microsoft/vscode's own git.d.ts, not part of
// vscode.d.ts) — so this declares only the handful of fields actually read here, the same
// "narrow structural type" posture state.ts/cache-bridge.ts already established for
// vscode.Memento.
type GitChange = { uri: vscode.Uri };
type GitRepository = { state: { workingTreeChanges: GitChange[]; indexChanges: GitChange[] } };
type GitAPI = { repositories: GitRepository[] };
type GitExtensionExports = { getAPI(version: 1): GitAPI };

/**
 * Repo-relative, POSIX-separated paths of every file the built-in git extension currently
 * reports as dirty (working-tree or staged changes) anywhere under `rootDir` — across every
 * repository the extension knows about, not just one, so a submodule nested under `rootDir`
 * still contributes its own dirty files. Returns `[]` whenever git isn't actually usable for
 * any reason (extension not installed/enabled, no repository open, or the extension hasn't
 * finished activating) — ENGINEERING-CONSTRAINTS.md's "no git" is a named degrade state, never
 * a crash or a thrown error that would otherwise surface as a spurious "analysis failed" toast
 * (commands/show-architecture.ts's triggerAnalysis wraps the whole outcome handler in a
 * .catch()) since dirty markers are cosmetic, not part of the graph's truth.
 *
 * Deliberately queried fresh on every call rather than cached or event-subscribed: v1's own
 * stated scope for this state is "always fresh," and a graph/macro push is already the
 * natural cadence (on open, on save-triggered re-analysis) for markers to catch up — no
 * separate git-state-changed listener needed for that cadence to feel live.
 */
export async function getDirtyFiles(rootDir: string): Promise<string[]> {
  try {
    const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!extension) return [];
    const exports = extension.isActive ? extension.exports : await extension.activate();
    const api = exports.getAPI(1);
    const dirty = new Set<string>();
    for (const repo of api.repositories) {
      for (const change of [...repo.state.workingTreeChanges, ...repo.state.indexChanges]) {
        const rel = posixRelative(rootDir, change.uri.fsPath);
        if (rel) dirty.add(rel);
      }
    }
    return [...dirty];
  } catch {
    // Any failure here (a misbehaving third-party git-alternative extension also registered
    // under the 'vscode.git' id, a getAPI version mismatch, activation throwing) degrades to
    // "no markers," never propagates — see this function's own doc comment.
    return [];
  }
}

/** POSIX-separated path of `absPath` relative to `rootDir`, or `undefined` if `absPath` isn't
 * actually under `rootDir` (a dirty file from an unrelated repository the git extension also
 * happens to know about, or a path-escape via `..`) — the containment check itself is
 * `@blocknet/core/path-utils`'s `isWithinRoot`, the same shared predicate
 * `change-buffer.ts` already imports from the identical subpath, not a re-derived copy. */
function posixRelative(rootDir: string, absPath: string): string | undefined {
  const rel = relative(rootDir, absPath).split('\\').join('/');
  return isWithinRoot(rel) ? rel : undefined;
}
