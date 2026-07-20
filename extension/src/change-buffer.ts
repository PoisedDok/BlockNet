// From '@blocknet/core/path-utils', not the main '@blocknet/core' barrel — see core/src/
// index.ts's header comment: importing isExcludedPath through the main barrel would drag
// analyze.ts's dependency-cruiser graph (real top-level `await` in some of its own files)
// into this file's bundle, which esbuild cannot lower into the extension host's CJS target.
import { isExcludedPath } from '@blocknet/core/path-utils';

// Pure bookkeeping for watcher.ts's debounce buffer (docs/architecture/FLOWS.md §2) — zero
// `vscode` import, deliberately kept in its own file so it can be unit-tested directly.
// watcher.ts's FileWatcher (the thin `vscode`-API shell wiring real file-system events into
// this) can only be exercised inside a real extension host — importing the real `vscode`
// module outside one throws (there is no runtime shim, only @types/vscode's ambient types) —
// so it's verified manually via F5 instead, matching Task 6's acceptance criteria.

const CONFIG_BASENAMES = new Set(['package.json', 'tsconfig.json']);
export type ChangeKind = 'create' | 'change' | 'delete';

// `changedFiles` absent means "force a full scan" (config or structural change, decisions/0008's
// priority order); present (possibly empty) means every buffered change was a pure content
// edit. AnalyzeOptions.changedFiles is currently unread by analyze() (docs/decisions/0008's
// 2026-07-19 amendment) — passed through here anyway so this file's shape matches
// docs/architecture/FLOWS.md's diagram exactly and needs no rewrite the day that changes;
// core's own cache/invalidate.ts self-detects the real classification via content hashing
// regardless of what's passed, so nothing here depends on changedFiles being read.
export type WatcherTrigger = { changedFiles?: string[] };

/** Accumulates file-system events between debounce firings and classifies them
 * (config / structural / content) per decisions/0008's priority order — config overrides
 * structural overrides content, matching cache/invalidate.ts's own InvalidationPlan
 * priority. Excluded paths (node_modules, build output, dot-directories —
 * `@blocknet/core`'s isExcludedPath, not a re-derived pattern) are dropped before
 * classification, same predicate the rest of the pipeline uses. */
export class ChangeBuffer {
  #files = new Set<string>();
  #hasStructuralChange = false;
  #hasConfigChange = false;

  record(kind: ChangeKind, posixRelativePath: string): void {
    if (isExcludedPath(posixRelativePath)) return;

    const basename = posixRelativePath.split('/').pop() ?? '';
    if (CONFIG_BASENAMES.has(basename)) {
      this.#hasConfigChange = true;
      return;
    }
    if (kind === 'create' || kind === 'delete') {
      this.#hasStructuralChange = true;
      return;
    }
    this.#files.add(posixRelativePath);
  }

  get isEmpty(): boolean {
    return !this.#hasConfigChange && !this.#hasStructuralChange && this.#files.size === 0;
  }

  /** Consumes and returns the buffered state, clearing it either way. */
  flush(): WatcherTrigger {
    const forceFullScan = this.#hasConfigChange || this.#hasStructuralChange;
    const trigger: WatcherTrigger = forceFullScan ? {} : { changedFiles: [...this.#files] };
    this.#hasConfigChange = false;
    this.#hasStructuralChange = false;
    this.#files.clear();
    return trigger;
  }
}
