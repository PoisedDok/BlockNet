// Diffs a previous CacheManifest against the current one to decide how much of analyze()'s
// work can be skipped (docs/decisions/0008). Priority order matters and is deliberate, not
// incidental — each check below is strictly broader than the ones after it, so the first
// match wins:
//
// 1. cold        — no valid previous state to compare against at all.
// 2. config-changed — a package.json/tsconfig.json changed anywhere in the tree. This can
//    change import resolution globally (aliases, exports/main, workspace membership) in ways
//    no per-file diff can localize, so it overrides every narrower signal below it.
// 3. structural-changed — a file was added or removed. A new/deleted file can change how
//    OTHER, unrelated files' imports resolve (a previously-couldNotResolve specifier now
//    resolving, a barrel/index file appearing or disappearing) — correctly scoping just the
//    "dependents" of an add/delete would require a reverse-dependency index over unresolved
//    specifiers this engine doesn't build (see docs/planning/PROGRESS.md's Task 5 entry for
//    why that was rejected as an unvalidated guess, the same class of mistake ADR-0008 already
//    rejected once for SCC scoping). Falling back to a full rescan here is the safe, correct
//    choice, not a missed optimization.
// 4. unchanged    — every file's hash matches and the file set is identical: the previous
//    GraphResult snapshot is still exactly true, serve it verbatim.
// 5. content-changed — the only case ADR-0008 rule 1 actually scopes: some existing files'
//    OWN content changed, nothing was added or removed, and config is untouched. Only these
//    files' own outgoing edges need re-extraction.
import type { CacheManifest } from '../types.js';

export type InvalidationPlan =
  | { kind: 'cold' }
  | { kind: 'config-changed' }
  | { kind: 'structural-changed' }
  | { kind: 'unchanged' }
  | { kind: 'content-changed'; modifiedFiles: string[] };

export function planInvalidation(previous: CacheManifest | undefined, current: CacheManifest): InvalidationPlan {
  if (previous === undefined || previous.version !== current.version) {
    return { kind: 'cold' };
  }

  if (previous.configHash !== current.configHash) {
    return { kind: 'config-changed' };
  }

  const previousPaths = Object.keys(previous.files);
  const currentPaths = Object.keys(current.files);
  if (previousPaths.length !== currentPaths.length || currentPaths.some((path) => !(path in previous.files))) {
    return { kind: 'structural-changed' };
  }

  const modifiedFiles = currentPaths.filter((path) => current.files[path]?.hash !== previous.files[path]?.hash);
  if (modifiedFiles.length === 0) {
    return { kind: 'unchanged' };
  }

  return { kind: 'content-changed', modifiedFiles };
}
