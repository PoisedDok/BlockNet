import { useCallback, useEffect, useRef, useState } from 'react';
import type { Position } from './flow/layout.js';
import { postToHost } from './host-bridge.js';

const PERSIST_DEBOUNCE_MS = 300;

/** Owns the webview's own view of node positions (docs/architecture/FLOWS.md §4): seeded from
 * the host's layout/restore payload, updated optimistically on every drag/arrow-key move
 * (BlockCanvas.tsx's onNodesChange), and debounced back to the host as layout/persist so a
 * flurry of drag-frame updates becomes one workspaceState write, not one per pixel moved.
 *
 * Deliberately sparse, same as the map layout/restore hands it: only ids this session (or a
 * prior one) has actually moved, never a full snapshot of layout.ts's dagre output — see
 * layout.ts's own comment for why new/unmoved blocks must keep falling through to a fresh
 * dagre position instead of a stale persisted one. */
export function useCameraStore(initialPositions: Record<string, Position>) {
  const [positions, setPositions] = useState(initialPositions);
  const isFirstRender = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Kept current via its own effect (never written during render — React's rules-of-hooks
  // lint correctly flags a direct `ref.current = x` in the render body as unsafe under
  // concurrent rendering) so the unmount-only flush below can read the latest positions
  // without capturing a stale value from whichever render happened to set up that effect.
  const positionsRef = useRef(positions);
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  const movePosition = useCallback((id: string, position: Position) => {
    setPositions((prev) => ({ ...prev, [id]: position }));
  }, []);

  useEffect(() => {
    // Skip the mount-time effect run — `positions` here is still exactly what layout/restore
    // handed in, so persisting it back would be a wasted (if harmless) round-trip on every
    // single panel open.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      postToHost({ type: 'layout/persist', positions });
    }, PERSIST_DEBOUNCE_MS);
  }, [positions]);

  // Separate, mount-once effect so its cleanup only ever runs on a genuine unmount, not on
  // every intermediate position change the debounce effect above already handles — a combined
  // effect's cleanup can't tell those two cases apart. Without this, a debounce still pending
  // when the component actually unmounts (BlockCanvas re-rendering because a live graph/macro
  // update swapped it out, or the panel closing mid-drag) silently loses up to 300ms of the
  // most recent drag movement instead of persisting it — a real gap two-pass review found.
  useEffect(() => {
    return () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        postToHost({ type: 'layout/persist', positions: positionsRef.current });
      }
    };
  }, []);

  return { positions, movePosition };
}
