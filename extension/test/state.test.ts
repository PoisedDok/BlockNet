import { describe, expect, it } from 'vitest';
import {
  getEdgeWaypoints,
  getFileEdgeWaypoints,
  getFilePositions,
  getPositions,
  setEdgeWaypoints,
  setFileEdgeWaypoints,
  setFilePositions,
  setPositions,
  type WorkspaceMemento,
} from '../src/state.js';

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

describe('getFilePositions (file-level drag parity with block positions)', () => {
  it('returns an empty object when nothing has been persisted yet', () => {
    expect(getFilePositions(fakeMemento())).toEqual({});
  });

  it('returns the persisted file-positions map verbatim', () => {
    const memento = fakeMemento({ 'blocknet.filePositions': { 'src/a.ts': { x: 10, y: 20 } } });
    expect(getFilePositions(memento)).toEqual({ 'src/a.ts': { x: 10, y: 20 } });
  });

  it('is stored independently of blocknet.positions — setting one never touches the other', async () => {
    const memento = fakeMemento({ 'blocknet.positions': { a: { x: 1, y: 2 } } });
    await setFilePositions(memento, { 'src/a.ts': { x: 3, y: 4 } });
    expect(getPositions(memento)).toEqual({ a: { x: 1, y: 2 } });
    expect(getFilePositions(memento)).toEqual({ 'src/a.ts': { x: 3, y: 4 } });
  });
});

describe('setFilePositions', () => {
  it('writes the full file-positions map, readable back via getFilePositions', async () => {
    const memento = fakeMemento();
    await setFilePositions(memento, { 'src/a.ts': { x: 1, y: 2 }, 'src/b.ts': { x: 3, y: 4 } });
    expect(getFilePositions(memento)).toEqual({ 'src/a.ts': { x: 1, y: 2 }, 'src/b.ts': { x: 3, y: 4 } });
  });

  it('replaces (not merges) the previous file-positions map on each call', async () => {
    const memento = fakeMemento({ 'blocknet.filePositions': { 'src/a.ts': { x: 1, y: 2 }, stale: { x: 9, y: 9 } } });
    await setFilePositions(memento, { 'src/a.ts': { x: 5, y: 6 } });
    expect(getFilePositions(memento)).toEqual({ 'src/a.ts': { x: 5, y: 6 } });
  });
});

describe('getFileEdgeWaypoints (file-level drag parity with edge waypoints)', () => {
  it('returns an empty object when nothing has been persisted yet', () => {
    expect(getFileEdgeWaypoints(fakeMemento())).toEqual({});
  });

  it('returns the persisted file-edge-waypoints map verbatim', () => {
    const memento = fakeMemento({ 'blocknet.fileEdgeWaypoints': { e1: { x: 10, y: 20 } } });
    expect(getFileEdgeWaypoints(memento)).toEqual({ e1: { x: 10, y: 20 } });
  });

  it('is stored independently of blocknet.edgeWaypoints — setting one never touches the other', async () => {
    const memento = fakeMemento({ 'blocknet.edgeWaypoints': { e1: { x: 1, y: 2 } } });
    await setFileEdgeWaypoints(memento, { e1: { x: 3, y: 4 } });
    expect(getEdgeWaypoints(memento)).toEqual({ e1: { x: 1, y: 2 } });
    expect(getFileEdgeWaypoints(memento)).toEqual({ e1: { x: 3, y: 4 } });
  });
});

describe('setFileEdgeWaypoints', () => {
  it('writes the full file-edge-waypoints map, readable back via getFileEdgeWaypoints', async () => {
    const memento = fakeMemento();
    await setFileEdgeWaypoints(memento, { e1: { x: 1, y: 2 }, e2: { x: 3, y: 4 } });
    expect(getFileEdgeWaypoints(memento)).toEqual({ e1: { x: 1, y: 2 }, e2: { x: 3, y: 4 } });
  });

  it('replaces (not merges) the previous file-edge-waypoints map on each call', async () => {
    const memento = fakeMemento({ 'blocknet.fileEdgeWaypoints': { e1: { x: 1, y: 2 }, stale: { x: 9, y: 9 } } });
    await setFileEdgeWaypoints(memento, { e1: { x: 5, y: 6 } });
    expect(getFileEdgeWaypoints(memento)).toEqual({ e1: { x: 5, y: 6 } });
  });
});
