import { join, relative } from 'node:path';
import { isWithinRoot } from '@blocknet/core/path-utils';
import * as vscode from 'vscode';

// `open/file` (docs/architecture/PROTOCOL.md, docs/decisions/0009) — the only webview→host
// message this file handles as of Task 9. `open/diff` stays defined in the protocol but
// unimplemented on both sides: it has no v1 UI trigger (deferred to ROADMAP-V2.md's v2.0
// micro view alongside block/file-level ⤢ — see TASKS-V1.md's Task 9 scope correction),
// so there's nothing here to call it correctly against yet.

/** True if `fileId` (as received over postMessage from the webview — a boundary crossing,
 * ENGINEERING-CONSTRAINTS.md/CLAUDE.md's "validate at system boundaries") stays within
 * `rootDir` once resolved, rather than trusting it implicitly. In practice `fileId` always
 * originates from core's own analysis (`Risk.evidence[].file`), never from arbitrary webview
 * input, but this file has no way to prove that at the type level — the containment check
 * itself is `@blocknet/core/path-utils`'s `isWithinRoot`, the same shared predicate
 * `change-buffer.ts`/`git.ts` already import from the identical subpath, not a re-derived
 * copy (a real duplication two-pass review found and fixed here). */
function resolveWithinRoot(rootDir: string, fileId: string): vscode.Uri | undefined {
  const abs = join(rootDir, fileId);
  const rel = relative(rootDir, abs).split('\\').join('/');
  return isWithinRoot(rel) ? vscode.Uri.file(abs) : undefined;
}

/**
 * `showTextDocument(uri, { viewColumn: ViewColumn.Beside, selection })` — the graph panel
 * stays put, code opens in the adjacent column (docs/decisions/0009's "Claude Code pattern").
 * `line` is 1-indexed (matches `Evidence.line`'s convention, `core/src/edges/file-graph.ts`'s
 * `i + 1`); `vscode.Position` is 0-indexed, so this converts once, here, at the one place a
 * line number crosses from "human-readable" to "editor API" — never left for a caller to get
 * wrong independently. A missing or out-of-range line just opens the file without a specific
 * selection (`showTextDocument` clamps a Position past EOF to the last line itself, not this
 * file's job to pre-validate).
 */
export async function handleOpenFile(rootDir: string, fileId: string, line?: number): Promise<void> {
  const uri = resolveWithinRoot(rootDir, fileId);
  if (!uri) return;
  const options: vscode.TextDocumentShowOptions = { viewColumn: vscode.ViewColumn.Beside };
  if (line !== undefined && line >= 1) options.selection = new vscode.Range(line - 1, 0, line - 1, 0);
  try {
    await vscode.window.showTextDocument(uri, options);
  } catch (err) {
    // A file real at analysis time can be gone by click time (deleted/renamed between the
    // last graph/macro push and this click) — showTextDocument rejects with "cannot open
    // file"; degrade to a toast, never an unhandled rejection crashing the extension host.
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`BlockNet: couldn't open ${fileId} — ${message}`);
  }
}
