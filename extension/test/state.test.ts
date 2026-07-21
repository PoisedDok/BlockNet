import { describe, expect, it } from 'vitest';
import { getPositions, setPositions, type WorkspaceMemento } from '../src/state.js';

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
