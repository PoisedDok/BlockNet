import * as vscode from 'vscode';
import type { AnalysisOutcome, AnalysisRunner, LayerOutcome } from '../analysis-runner.js';
import { resolveCacheDir } from '../cache-bridge.js';
import { dirtyBlockIds } from '../dirty-blocks.js';
import { getDirtyFiles } from '../git.js';
import { ArchitecturePanel } from '../panel.js';
import { getEdgeWaypoints, getPositions, setEdgeWaypoints, setPositions } from '../state.js';
import type { WatcherTrigger } from '../watcher.js';
import { FileWatcher } from '../watcher.js';
import { handleOpenFile } from './open-file.js';

type TriggerOptions = { rootDir: string; cacheDir: string } & WatcherTrigger;

/** Forks one analysis run, streams its progress to the panel, and — only if this run is
 * still the latest one issued (docs/architecture/FLOWS.md §2a: a superseded run's result is
 * discarded silently, never forwarded) — pushes graph/macro + risks/update.
 *
 * Two independent generations gate every `panel.post()` here, not one: `runner.isLatest()`
 * (the *analysis* generation — is this the newest analysis run?) and
 * `panel.isCurrentGeneration()` (the *panel* generation — is the webview script this would
 * post into still the one actually listening?). Two-pass review found the command-kickoff
 * call site (below, in registerShowArchitectureCommand) already re-checks the panel
 * generation after its own await, because a rapid re-invocation can reassign `webview.html`
 * (minting a new generation) between the check and the post — but that fix never propagated
 * here. `triggerAnalysis` is reachable both from that kickoff path (after an arbitrarily long
 * analysis) and from every `FileWatcher` trigger (which never checked panel generation at
 * all), so the same stale-post race applies to every message type posted below, not just
 * graph/macro. `panelGeneration` is captured once, at call time — both call sites only ever
 * invoke this once the panel is already 'ready', so it reflects the panel instance this
 * particular run's results actually belong to. */
function triggerAnalysis(runner: AnalysisRunner, panel: ArchitecturePanel, options: TriggerOptions): void {
  const panelGeneration = panel.currentGeneration;
  const { generation, result } = runner.run({
    ...options,
    onProgress: (p) => {
      if (panel.isCurrentGeneration(panelGeneration)) panel.post({ type: 'analysis/progress', ...p });
    },
  });

  result
    .then(async (outcome: AnalysisOutcome) => {
      if (!runner.isLatest(generation)) return;
      if (outcome.kind === 'success') {
        // Dirty markers are queried live on every push (docs/architecture/STATE-OWNERSHIP.md)
        // — getDirtyFiles never throws (git.ts degrades to [] on any failure), so this can't
        // turn an otherwise-successful analysis into a spurious "analysis failed" toast via
        // the .catch() below.
        const dirtyFiles = await getDirtyFiles(options.rootDir);
        const dirty = dirtyBlockIds(outcome.graph.blocks, dirtyFiles);
        const nodes = outcome.graph.blocks.map((block) => ({ ...block, dirty: dirty.has(block.id) }));
        if (!runner.isLatest(generation) || !panel.isCurrentGeneration(panelGeneration)) return;
        panel.post({ type: 'graph/macro', nodes, edges: outcome.graph.edges });
        panel.post({ type: 'risks/update', risks: outcome.graph.risks });
      } else {
        // A stale-panel-generation error is still worth surfacing — showErrorMessage is a
        // global VS Code notification, not a postMessage into a specific webview instance, so
        // it can't be silently dropped the way panel.post() can; no panel-generation gate here.
        // outcome.message may be a full stack trace (ipc-worker.ts captures err.stack for
        // debugging) — only its first line belongs in a transient toast; the full message
        // still reaches the console for anyone actually debugging the failure.
        console.error(outcome.message);
        void vscode.window.showErrorMessage(`BlockNet analysis failed: ${outcome.message.split('\n')[0]}`);
      }
    })
    .catch((err: unknown) => {
      if (!runner.isLatest(generation)) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(err);
      void vscode.window.showErrorMessage(`BlockNet analysis failed: ${message}`);
    });
}

/** Forks one layer (item/edge/arrow) query for a folder navigation (docs/planning/
 * ROADMAP-V2.md's v2.0.1 unified layer model) — every layer, including layer 0, goes through
 * this one path now. Same dual-generation gate as triggerAnalysis above, against
 * runner.isLatestLayer() (this stream's OWN independent counter — analysis-runner.ts's own
 * comment on why it can't share the macro counter) and panel.isCurrentGeneration().
 *
 * Unlike triggerAnalysis, a failure here does NOT go through vscode.window.showErrorMessage —
 * it's local to the layer the user just navigated to (a missing cache, a since-removed
 * layerPath), not a whole-panel failure, so it's posted back as `graph/layer/error` instead,
 * letting the webview fall back to the previous layer with an inline notice rather than a
 * global toast plus a webview stuck mid-transition with nothing to correct it (PROTOCOL.md).
 *
 * Dirty markers reuse dirty-blocks.ts's dirtyBlockIds() UNCHANGED for folder items — it was
 * already generically typed ({id,path}[]), never block-specific, just narrowly called until
 * now — and exact-file-id-membership for file items. */
function triggerLayerAnalysis(runner: AnalysisRunner, panel: ArchitecturePanel, options: { rootDir: string; cacheDir: string; layerPath: string }): void {
  const panelGeneration = panel.currentGeneration;
  const { generation, result } = runner.runLayer(options);

  result
    .then(async (outcome: LayerOutcome) => {
      if (!runner.isLatestLayer(generation)) return;
      if (outcome.kind === 'success') {
        const dirtyFiles = await getDirtyFiles(options.rootDir);
        const dirtySet = new Set(dirtyFiles);
        const dirtyFolders = dirtyBlockIds(
          outcome.layer.items.filter((i) => i.kind === 'folder'),
          dirtyFiles,
        );
        // A doc-stack has no single path of its own to check — it's dirty if ANY of its own
        // constituent files is (exact-membership, the same check file items use, just applied
        // across the whole set instead of one path). Missing this case would silently always
        // report `dirty: false` for a doc-stack, since it's neither a 'file' nor a 'folder'.
        const items = outcome.layer.items.map((item) => {
          if (item.kind === 'file') return { ...item, dirty: dirtySet.has(item.path) };
          if (item.kind === 'folder') return { ...item, dirty: dirtyFolders.has(item.id) };
          return { ...item, dirty: item.files.some((f) => dirtySet.has(f.path)) };
        });
        if (!runner.isLatestLayer(generation) || !panel.isCurrentGeneration(panelGeneration)) return;
        panel.post({ type: 'graph/layer', layerPath: outcome.layer.layerPath, items, edges: outcome.layer.edges, arrows: outcome.layer.arrows });
      } else {
        console.error(outcome.message);
        if (!panel.isCurrentGeneration(panelGeneration)) return;
        panel.post({ type: 'graph/layer/error', layerPath: options.layerPath, message: outcome.message.split('\n')[0] ?? outcome.message });
      }
    })
    .catch((err: unknown) => {
      if (!runner.isLatestLayer(generation) || !panel.isCurrentGeneration(panelGeneration)) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(err);
      panel.post({ type: 'graph/layer/error', layerPath: options.layerPath, message });
    });
}

/** `blocknet.showArchitecture` — creates/reveals the panel (docs/architecture/FLOWS.md's
 * "cold analyze" and "incremental re-analyze" flows). No workspace or a multi-root workspace
 * are named, visible unsupported states (ENGINEERING-CONSTRAINTS.md) rendered in the panel
 * itself, not a popup — v1 analyzes exactly one workspace root. */
export function registerShowArchitectureCommand(context: vscode.ExtensionContext, runner: AnalysisRunner): vscode.Disposable {
  // Scoped to this closure, not per-invocation: re-running the command (the panel is a
  // singleton, so a re-invocation while already open is just a reveal — a normal action, not
  // a rare one) must not construct a second live FileWatcher for the same root. Two-pass
  // review found the previous unconditional `new FileWatcher(...)` on every call leaks one
  // permanently per invocation (pushed to context.subscriptions, disposed only at
  // deactivation) — N invocations means every subsequent save forks N redundant analyses. Not
  // a correctness bug (AnalysisRunner's generation counter still means only the true latest
  // result is ever forwarded — FLOWS.md §2a), but real, unbounded, wasted CPU/process-fork
  // cost on a repo-scale operation for a genuinely ordinary user action.
  let watchedRootDir: string | undefined;

  return vscode.commands.registerCommand('blocknet.showArchitecture', () => {
    const folders = vscode.workspace.workspaceFolders;

    // No script ever runs for these two degrade states (enableScripts: false), so there's no
    // webview to post layout/persist, open/file, or graph/layer/request back — all three
    // callbacks are unreachable, not just unused.
    const noopOnLayoutPersist = () => {};
    const noopOnOpenFile = () => {};
    const noopOnLayerRequest = () => {};

    if (folders === undefined || folders.length === 0) {
      ArchitecturePanel.createOrReveal('no-workspace', context.extensionUri, noopOnLayoutPersist, noopOnOpenFile, noopOnLayerRequest);
      return;
    }
    if (folders.length > 1) {
      ArchitecturePanel.createOrReveal('multi-root', context.extensionUri, noopOnLayoutPersist, noopOnOpenFile, noopOnLayerRequest);
      return;
    }

    const workspaceFolder = folders[0];
    if (workspaceFolder === undefined) {
      // Unreachable given the length checks above; satisfies noUncheckedIndexedAccess.
      return;
    }
    const rootDir = workspaceFolder.uri.fsPath;
    const cacheDir = resolveCacheDir(context);
    const panel = ArchitecturePanel.createOrReveal(
      'ready',
      context.extensionUri,
      (positions, edgeWaypoints) => {
        // camera-store.ts sends both fields together as one layout/persist event specifically
        // so they can't race as two independently-debounced writes — but these two
        // memento.update() calls are still two separate writes to two separate workspaceState
        // keys, not one atomic write. A process kill between the two resolving could in theory
        // leave the pair inconsistent with what the webview actually sent. Checked and
        // accepted, not fixed: VS Code's own storage service coalesces multiple `.update()`
        // calls issued in the same host tick into one on-disk flush in practice, and this is
        // view-state (a dropped edge bend, not import truth) — cache/store.ts's single-file
        // atomic write exists because THAT data is truth a stale read would silently trust;
        // losing one of two positions/waypoints writes here just means a drag needs to be redone.
        void setPositions(context.workspaceState, positions);
        void setEdgeWaypoints(context.workspaceState, edgeWaypoints);
      },
      (fileId, line) => {
        void handleOpenFile(rootDir, fileId, line);
      },
      (layerPath) => {
        triggerLayerAnalysis(runner, panel, { rootDir, cacheDir, layerPath });
      },
    );

    // PROTOCOL.md's ordering guarantee: layout/restore must reach the webview before
    // graph/macro, so the first paint has persisted positions and never flashes a default
    // layout that then jumps. whenReady() gates both sends on the webview's own script having
    // actually registered its message listener — see panel.ts's whenReady() for why that's
    // load-bearing, not just a nicety.
    //
    // generation is captured now, synchronously, right after createOrReveal() mints it — and
    // re-checked via isCurrentGeneration() after whenReady() resolves, not just relied on
    // implicitly. Two-pass review traced a real gap: whenReady() resolving only proves ITS
    // generation's script became ready at some point; a rapid re-invocation of this same
    // command (e.g. a doubled keybinding) can mint a NEWER generation — reassigning
    // webview.html again — before this .then() callback runs, at which point posting into the
    // panel would silently land in a torn-down script instance (dropped, no queue). Skipping
    // the post entirely when superseded is the actual fix; matching inside whenReady() alone
    // only prevents resolving on the wrong wait, not this later race.
    const generation = panel.currentGeneration;
    void panel.whenReady().then(() => {
      if (!panel.isCurrentGeneration(generation)) return;
      panel.post({
        type: 'layout/restore',
        positions: getPositions(context.workspaceState),
        edgeWaypoints: getEdgeWaypoints(context.workspaceState),
      });
      triggerAnalysis(runner, panel, { rootDir, cacheDir });
    });

    // v1 analyzes exactly one workspace root for the extension's whole lifetime (no
    // multi-root support, and VS Code doesn't let workspaceFolders[0] change without a window
    // reload) — so "already watching this rootDir" is the only real dedup check needed; it
    // isn't trying to handle a root actually changing underneath a live watcher.
    if (watchedRootDir !== rootDir) {
      const watcher = new FileWatcher(workspaceFolder, (trigger) => {
        triggerAnalysis(runner, panel, { rootDir, cacheDir, ...trigger });
      });
      context.subscriptions.push(watcher);
      watchedRootDir = rootDir;
    }
  });
}
