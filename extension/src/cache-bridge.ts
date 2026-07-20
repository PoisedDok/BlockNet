// Resolves `context.storageUri` (workspace-scoped) into the plain filesystem path analyze()'s
// `cacheDir` option expects (docs/architecture/STATE-OWNERSHIP.md's "ONE JSON file under
// context.storageUri" line). Takes a narrow structural type (just the one field it needs)
// instead of importing `vscode.ExtensionContext` — a real `vscode.Uri` satisfies this shape,
// but so does a plain object in a test, so this file needs no `vscode` import and no mock of
// one either.
export type StorageContext = { storageUri: { fsPath: string } | undefined };

/** Throws if called without an open workspace — `context.storageUri` is only ever undefined
 * in that case, and the caller (extension.ts) already refuses to analyze then
 * (ENGINEERING-CONSTRAINTS.md's "no workspace" degrade), so this path is unreachable in
 * practice, not a state this function needs to degrade gracefully for itself. */
export function resolveCacheDir(context: StorageContext): string {
  if (context.storageUri === undefined) {
    throw new Error('resolveCacheDir() called without an open workspace (context.storageUri is undefined)');
  }
  return context.storageUri.fsPath;
}
