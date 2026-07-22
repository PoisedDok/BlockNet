import { describe, expect, it } from 'vitest';
import { getEdgeWaypoints, getPositions, setEdgeWaypoints, setPositions, type WorkspaceMemento } from '../src/state.js';

function fakeMemento(initial: Record<string, unknown> = {}): WorkspaceMemento {
  const store = { ...initial };
  return {
    get: <T>(key: string, defaultValue: T): T => (key in store ? (store[key] as T) : defaultValue),
    update: (key: string, value: unknown): Thenable<void> => {
      store[key] = value;
      return Promise.resolve();
    },
  };
}

describe('getPositions', () => {
  it('returns an empty object when nothing has been persisted yet', () => {
    expect(getPositions(fakeMemento())).toEqual({});
  });

  it('returns the persisted positions map verbatim', () => {
    const memento = fakeMemento({ 'blocknet.positions': { a: { x: 10, y: 20 } } });
    expect(getPositions(memento)).toEqual({ a: { x: 10, y: 20 } });
  });
});

describe('setPositions', () => {
  it('writes the full positions map, readable back via getPositions', async () => {
    const memento = fakeMemento();
    await setPositions(memento, { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
    expect(getPositions(memento)).toEqual({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
  });

  it('replaces (not merges) the previous positions map on each call', async () => {
    const memento = fakeMemento({ 'blocknet.positions': { a: { x: 1, y: 2 }, stale: { x: 9, y: 9 } } });
    await setPositions(memento, { a: { x: 5, y: 6 } });
    expect(getPositions(memento)).toEqual({ a: { x: 5, y: 6 } });
  });
});

describe('getEdgeWaypoints (ROADMAP-V2.md draggable/bendable edge routing)', () => {
  it('returns an empty object when nothing has been persisted yet', () => {
    expect(getEdgeWaypoints(fakeMemento())).toEqual({});
  });

  it('returns the persisted edge-waypoints map verbatim', () => {
    const memento = fakeMemento({ 'blocknet.edgeWaypoints': { e1: { x: 10, y: 20 } } });
    expect(getEdgeWaypoints(memento)).toEqual({ e1: { x: 10, y: 20 } });
  });

  it('is stored independently of blocknet.positions — setting one never touches the other', async () => {
    const memento = fakeMemento({ 'blocknet.positions': { a: { x: 1, y: 2 } } });
    await setEdgeWaypoints(memento, { e1: { x: 3, y: 4 } });
    expect(getPositions(memento)).toEqual({ a: { x: 1, y: 2 } });
    expect(getEdgeWaypoints(memento)).toEqual({ e1: { x: 3, y: 4 } });
  });
});

describe('setEdgeWaypoints', () => {
  it('writes the full edge-waypoints map, readable back via getEdgeWaypoints', async () => {
    const memento = fakeMemento();
    await setEdgeWaypoints(memento, { e1: { x: 1, y: 2 }, e2: { x: 3, y: 4 } });
    expect(getEdgeWaypoints(memento)).toEqual({ e1: { x: 1, y: 2 }, e2: { x: 3, y: 4 } });
  });

  it('replaces (not merges) the previous edge-waypoints map on each call', async () => {
    const memento = fakeMemento({ 'blocknet.edgeWaypoints': { e1: { x: 1, y: 2 }, stale: { x: 9, y: 9 } } });
    await setEdgeWaypoints(memento, { e1: { x: 5, y: 6 } });
    expect(getEdgeWaypoints(memento)).toEqual({ e1: { x: 5, y: 6 } });
  });
});
