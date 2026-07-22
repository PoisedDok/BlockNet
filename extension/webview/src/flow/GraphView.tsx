import { useEffect, useRef, useState } from 'react';
import type { LayerArrow, LayerEdge } from '@blocknet/core';
import type { Position, WebviewLayerItem } from '../../../src/shared/protocol.js';
import { LayerCanvas } from './LayerCanvas.js';
import { FloorPicker } from '../ui/FloorPicker.js';
import { useCameraStore } from '../camera-store.js';
import './GraphView.css';

// ~0.45–0.5s per the design-handoff prototype (docs/planning/ROADMAP-V2.md's v2.0 spec) —
// GraphView.css's transition duration and this JS-side unmount delay must stay in sync (the
// delay exists purely so the outgoing LayerCanvas instance survives long enough to actually
// render its own fade-out, matching camera-store.ts's own precedent of a JS timer paired with
// a CSS transition length).
const TRANSITION_MS = 500;

export type LayerPayload = { layerPath: string; items: WebviewLayerItem[]; edges: LayerEdge[]; arrows: LayerArrow[] };
export type LayerErrorPayload = { layerPath: string; message: string };

type StackEntry = { path: string; name: string };

export type GraphViewProps = {
  /** Latest successful graph/layer response from the host, if any — undefined until the very
   * first layer-0 request ever completes. Compared against local pendingLayer state below,
   * never trusted positionally, since a stale response for a superseded navigation can still
   * arrive (the host-side dual-generation gate already discards most of these —
   * analysis-runner.ts's isLatestLayer — this is the client-side second layer of the same
   * belt-and-suspenders pattern Task 9 established for graph/macro). */
  layer?: LayerPayload | undefined;
  layerError?: LayerErrorPayload | undefined;
  onRequestLayer: (layerPath: string) => void;
  initialPositions?: Record<string, Position>;
  initialEdgeWaypoints?: Record<string, Position[]>;
};

/** Owns the layer-to-layer cross-fade and the navigation stack (docs/planning/ROADMAP-V2.md's
 * v2.0.1 unified layer model) — every layer, including layer 0, is fetched via the identical
 * graph/layer/request round trip and rendered through the identical LayerCanvas, so "dive into
 * a folder" and "go back" are the SAME operation (navigateTo), just pushing vs. popping the
 * stack. This deliberately does NOT cache a previously-visited layer's data — going back
 * re-requests it, symmetric with diving forward — see ROADMAP-V2.md's "process-boundary
 * judgment call" for why that's an accepted, measured-not-guessed simplification rather than a
 * gap; if live verification shows back-navigation feels slow, a small parent-layer cache is the
 * fix, added then with real data, not speculatively now.
 *
 * The mount-then-flip effect structure below is copied deliberately close to the shape this
 * project's earlier (now-retired) macro/micro GraphView proved correct through several
 * live-reproduced race fixes (a two-tick mount, unconditional effect cleanup so a superseded
 * navigation's stale timer can never fire under a newer one's identity) — see each effect's own
 * comment for the specific race it closes. One real structural difference from that retired
 * version: the "current" slot here is NOT a permanently-mounted, always-available layer the way
 * old macro data was (a stable prop from App.tsx) — every layer's data is transient, so this
 * component freezes it into `shownData` at the moment a transition settles, rather than
 * re-deriving "what's currently shown" from the live `layer` prop on every render (that prop
 * gets overwritten the instant a NEWER response arrives, which would otherwise blank the
 * still-fading-out layer mid-transition — a real bug caught while designing this, not
 * hypothetical). */
export function GraphView({ layer, layerError, onRequestLayer, initialPositions, initialEdgeWaypoints }: GraphViewProps) {
  const [stack, setStack] = useState<StackEntry[]>([{ path: '', name: 'System Map' }]);
  const shown = stack[stack.length - 1] as StackEntry;

  // `nextStack` is the FULL resulting stack once this navigation settles, computed once at
  // navigate-time by whichever caller triggered it (a dive appends one entry; a floor-picker
  // jump truncates to an ancestor index; an inter-layer arrow reconstructs the whole ancestor
  // chain for a target that might be on an entirely different branch) — not a push/pop
  // instruction applied later. One shape for all three navigation sources, since "what the
  // stack should look like when we arrive" is trivial to compute up front and the settle step
  // then has nothing to decide, only to apply.
  type PendingLayer = { path: string; name: string; nextStack: StackEntry[] };
  const [shownData, setShownData] = useState<LayerPayload>();
  const [pendingLayer, setPendingLayer] = useState<PendingLayer>();
  const [nextMounted, setNextMounted] = useState(false);
  const [phase, setPhase] = useState<'resting' | 'diving' | 'transitioning'>('resting');
  const [banner, setBanner] = useState<string>();
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ONE camera-store instance for the panel's whole lifetime, spanning every item/edge at every
  // layer ever visited this session — the unified position/waypoint map (docs/planning/
  // ROADMAP-V2.md's "State keying, generalized") replaces what used to be two separate
  // instances (macro-only, file-level) precisely because every id is already globally unique by
  // repo-relative path. Owning it here (not inside LayerCanvas, which remounts on every
  // navigation via its own `key`) is what lets a drag made during one visit to a layer survive
  // a "dive deeper, come back" round trip within the same session.
  const { positions, movePosition, edgeWaypoints, moveWaypoints } = useCameraStore(initialPositions ?? {}, initialEdgeWaypoints ?? {});

  // Initial load only: the very first graph/layer response ever received (always for layer 0,
  // '', since that's `stack`'s seeded starting entry) — there is nothing to cross-fade FROM yet,
  // so this bypasses the navigation machinery entirely. This is React's own documented
  // "adjusting state during render" pattern — `shownData === undefined` is both the guard AND
  // what makes this self-limiting: calling setShownData below makes the guard false on the
  // very next render, so this never runs a second time, with no ref or extra state needed to
  // track "already initialized." Wrapping this in an effect instead would need an artificial
  // setTimeout(0) delay before the very first paint, purely to satisfy the "no synchronous
  // setState in an effect body" lint rule (or fail to run at all for a `layer` prop already
  // available synchronously on mount, which every fixture/dev path here relies on) — this
  // avoids that delay entirely.
  if (shownData === undefined && pendingLayer === undefined && layer && layer.layerPath === shown.path) {
    setShownData(layer);
  }

  // Navigation arrival: mounts the incoming layer's canvas (still invisible) on one tick, then
  // flips the CSS cross-fade on the next — collapsing both into one tick would let the browser
  // coalesce the hidden and visible styles into a single paint, skipping the transition
  // entirely (the same real, live-reproduced defect this two-tick shape fixed once already).
  // Returning cleanup unconditionally (not only when the guard below stops passing) is what
  // guarantees a superseded navigation's own timers are always cancelled the moment a NEWER one
  // starts, even before the newer one's own response has arrived — the exact race a stale timer
  // chain applying old data under a new identity would otherwise reopen.
  //
  // The settle step (freeze shownData, commit the stack push/pop, tear down the outgoing
  // canvas) is scheduled via `unmountTimer` — a plain ref, not a THIRD nested effect-tracked
  // timer — deliberately: `setPhase('transitioning')` just below changes one of THIS effect's
  // own dependencies, so React schedules a cleanup-then-rerun of this exact effect the moment
  // that state commits. A settle timer captured in this effect's own closure would get
  // cancelled by that self-triggered cleanup the instant it fired — before its 500ms elapsed,
  // never once. This was a real bug caught by a test exercising a SECOND navigation after the
  // first had settled (a same-render assertion couldn't tell "mid-transition" and "settled"
  // apart, since both render identical DOM here — only a subsequent navigation exposes it).
  // unmountTimer is immune because it isn't read by any effect's dependency array — the same
  // reasoning the retired GraphView's own handleBack unmount timer already relied on.
  useEffect(() => {
    if (phase !== 'diving' || !layer || !pendingLayer || layer.layerPath !== pendingLayer.path) return;
    const settled = pendingLayer;
    clearTimeout(unmountTimer.current);
    let innerTimer: ReturnType<typeof setTimeout> | undefined;
    const outerTimer = setTimeout(() => {
      setNextMounted(true);
      innerTimer = setTimeout(() => {
        setPhase('transitioning');
        unmountTimer.current = setTimeout(() => {
          setShownData(layer);
          setStack(settled.nextStack);
          setPendingLayer(undefined);
          setNextMounted(false);
          setPhase('resting');
        }, TRANSITION_MS);
      }, 0);
    }, 0);
    return () => {
      clearTimeout(outerTimer);
      clearTimeout(innerTimer);
    };
  }, [layer, phase, pendingLayer]);

  useEffect(() => {
    if (phase !== 'diving' || !layerError || !pendingLayer || layerError.layerPath !== pendingLayer.path) return;
    const timer = setTimeout(() => {
      setPendingLayer(undefined);
      setPhase('resting');
      // Resets the same three fields the settle path resets on success (setShownData is the
      // only one that doesn't apply here — there's no new data to show). Currently masked by
      // the `nextMounted && pendingLayer` render guard (pendingLayer is cleared above in the
      // same tick), but left set would be a real state-invariant violation the moment any
      // future code path ever reads nextMounted on its own.
      setNextMounted(false);
      setBanner(layerError.message);
    }, 0);
    return () => clearTimeout(timer);
  }, [layerError, phase, pendingLayer]);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(undefined), 4000);
    return () => clearTimeout(timer);
  }, [banner]);

  // Unmount-on-transition-end cleanup for a stray unmountTimer — scheduled outside any effect
  // in the arrival effect above, so it needs its own dedicated unmount guard, unlike effects
  // that now clean up after themselves automatically.
  useEffect(() => () => clearTimeout(unmountTimer.current), []);

  /** Starting a NEW navigation must unconditionally cancel any settle timer still pending from
   * an EARLIER one — a real, live-confirmed bug found via architectural review, not
   * hypothetical: the arrival effect above only ever clears `unmountTimer` on a run where its
   * own guard passes (`layer.layerPath === pendingLayer.path`), which stops happening the
   * instant a second navigation starts (pendingLayer now points at the NEW path, so every
   * effect run guards-out and returns early until the NEW layer's response arrives — never
   * touching the OLD, still-armed timer). If that second navigation is slower than the time
   * left on the first one's 500ms settle timer (a normal host round trip, not a rare
   * coincidence), the orphaned timer fires first and silently applies the FIRST navigation's
   * stale data/stack — including wiping out the second navigation's own still-in-flight
   * `pendingLayer`, discarding it entirely even if its response arrives correctly moments
   * later. Clearing it here, the instant any navigation begins, closes the gap at its actual
   * source rather than trying to re-derive "is this timer still valid" from the effect's own
   * dependency-triggered reruns. */
  function navigateTo(path: string, name: string, nextStack: StackEntry[]) {
    clearTimeout(unmountTimer.current);
    setPendingLayer({ path, name, nextStack });
    setPhase('diving');
    onRequestLayer(path);
  }

  function handleDive(itemId: string) {
    const item = shownData?.items.find((i) => i.id === itemId);
    if (item?.kind === 'folder') navigateTo(item.id, item.name, [...stack, { path: item.id, name: item.name }]);
  }

  /** Floor-picker click (docs/planning/ROADMAP-V2.md's v2.0.1 layer-stack navigator) — jump
   * straight to any ANCESTOR level, including "one back" — the in-canvas back button this
   * replaces was a special case of this same operation, not a separate mechanism, so it's
   * retired rather than kept alongside. A click on the already-current slab is a no-op
   * (nowhere to navigate); a click on a deeper index never happens (FloorPicker only ever
   * renders the current stack, never anything past it). */
  function handleJumpTo(index: number) {
    if (index === stack.length - 1) return;
    const target = stack[index] as StackEntry;
    navigateTo(target.path, target.name, stack.slice(0, index + 1));
  }

  /** Inter-layer arrow click (docs/planning/ROADMAP-V2.md's v2.0.1) — navigates to the
   * off-screen target file's own containing folder, reconstructing the FULL ancestor chain by
   * splitting its path into progressive prefixes rather than trying to extend the current
   * stack (an arrow can point at a completely unrelated branch, not just a level up or down
   * from here). Known, accepted simplification: this naive split doesn't know about AD-5's
   * block-compaction (docs/planning/ROADMAP-V2.md's v2.0.1 "compact-folder" behavior for
   * nested blocks — e.g. a block at `extension/webview` renders directly at layer 0, skipping
   * an `extension`-only step) — a target inside a compacted block could show one extra,
   * technically-redundant breadcrumb entry for an intermediate segment that isn't really its
   * own navigable layer. Every entry in the reconstructed chain still resolves correctly on its
   * own (itemsForLayer works for any path), so the worst case is a cosmetically imperfect
   * breadcrumb, never a broken navigation — resolving this properly needs a real host query
   * ("what's the true layer chain for this path"), out of scope for this pass. */
  function handleArrowNavigate(targetFile: string) {
    const lastSlash = targetFile.lastIndexOf('/');
    const targetLayerPath = lastSlash === -1 ? '' : targetFile.slice(0, lastSlash);
    const segments = targetLayerPath === '' ? [] : targetLayerPath.split('/');
    const nextStack: StackEntry[] = [{ path: '', name: 'System Map' }];
    let acc = '';
    for (const segment of segments) {
      acc = acc === '' ? segment : `${acc}/${segment}`;
      nextStack.push({ path: acc, name: segment });
    }
    const last = nextStack[nextStack.length - 1] as StackEntry;
    navigateTo(targetLayerPath, last.name, nextStack);
  }

  const showingNext = phase === 'transitioning';
  const nextData = pendingLayer && layer?.layerPath === pendingLayer.path ? layer : undefined;

  return (
    <div className="bn-graph-view">
      <div className="bn-current-layer" data-hidden={showingNext || undefined}>
        {shownData && (
          <LayerCanvas
            key={shown.path}
            layerPath={shown.path}
            items={shownData.items}
            edges={shownData.edges}
            arrows={shownData.arrows}
            onDive={handleDive}
            onArrowNavigate={handleArrowNavigate}
            initialPositions={positions}
            initialEdgeWaypoints={edgeWaypoints}
            onPositionChange={movePosition}
            onWaypointsChange={moveWaypoints}
          />
        )}
      </div>
      {nextMounted && pendingLayer && (
        <div className="bn-next-layer" data-visible={showingNext || undefined}>
          <LayerCanvas
            key={pendingLayer.path}
            layerPath={pendingLayer.path}
            items={nextData?.items ?? []}
            edges={nextData?.edges ?? []}
            arrows={nextData?.arrows ?? []}
            onDive={handleDive}
            onArrowNavigate={handleArrowNavigate}
            initialPositions={positions}
            initialEdgeWaypoints={edgeWaypoints}
            onPositionChange={movePosition}
            onWaypointsChange={moveWaypoints}
          />
        </div>
      )}
      <FloorPicker stack={stack} onJumpTo={handleJumpTo} />
      {phase === 'diving' && (
        <div className="bn-micro-loading" role="status">
          Loading…
        </div>
      )}
      {banner && (
        <div className="bn-micro-banner" role="alert">
          {banner}
        </div>
      )}
    </div>
  );
}
