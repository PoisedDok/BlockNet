import { describe, expect, it } from 'vitest';
import { CACHE_VERSION } from '../src/cache/manifest.js';
import { planInvalidation } from '../src/cache/invalidate.js';
import type { CacheManifest } from '../src/types.js';

function manifest(overrides: Partial<CacheManifest> = {}): CacheManifest {
  return {
    version: CACHE_VERSION,
    configHash: 'config-v1',
    files: {
      'src/a.ts': { hash: 'hash-a' },
      'src/b.ts': { hash: 'hash-b' },
    },
    ...overrides,
  };
}

describe('planInvalidation — cold start', () => {
  it('plans cold when there is no previous manifest', () => {
    expect(planInvalidation(undefined, manifest())).toEqual({ kind: 'cold' });
  });

  it('plans cold when the previous manifest is a different schema version', () => {
    const previous = manifest({ version: 999 });
    expect(planInvalidation(previous, manifest())).toEqual({ kind: 'cold' });
  });
});

describe('planInvalidation — config change wins over everything else', () => {
  it('plans config-changed when configHash differs, even with an identical file set', () => {
    const previous = manifest({ configHash: 'config-v1' });
    const current = manifest({ configHash: 'config-v2' });
    expect(planInvalidation(previous, current)).toEqual({ kind: 'config-changed' });
  });

  it('plans config-changed even when a file was also added — config change takes priority', () => {
    const previous = manifest({ configHash: 'config-v1' });
    const current = manifest({
      configHash: 'config-v2',
      files: { ...manifest().files, 'src/c.ts': { hash: 'hash-c' } },
    });
    expect(planInvalidation(previous, current)).toEqual({ kind: 'config-changed' });
  });
});

describe('planInvalidation — structural change (add/remove) forces a full bust', () => {
  it('plans structural-changed when a new file appears', () => {
    const previous = manifest();
    const current = manifest({
      files: { ...manifest().files, 'src/c.ts': { hash: 'hash-c' } },
    });
    expect(planInvalidation(previous, current)).toEqual({ kind: 'structural-changed' });
  });

  it('plans structural-changed when a file is removed', () => {
    const previous = manifest();
    const current = manifest({ files: { 'src/a.ts': { hash: 'hash-a' } } });
    expect(planInvalidation(previous, current)).toEqual({ kind: 'structural-changed' });
  });

  it('plans structural-changed (not content-changed) when an add/remove is combined with a real content change', () => {
    const previous = manifest();
    const current = manifest({
      files: {
        'src/a.ts': { hash: 'hash-a-MODIFIED' },
        'src/c.ts': { hash: 'hash-c' },
      },
    });
    expect(planInvalidation(previous, current)).toEqual({ kind: 'structural-changed' });
  });
});

describe('planInvalidation — unchanged', () => {
  it('plans unchanged when the file set and every hash are identical', () => {
    expect(planInvalidation(manifest(), manifest())).toEqual({ kind: 'unchanged' });
  });
});

describe('planInvalidation — content-changed (the scoped delta case)', () => {
  it('plans content-changed listing exactly the file(s) whose hash differs', () => {
    const previous = manifest();
    const current = manifest({
      files: { ...manifest().files, 'src/a.ts': { hash: 'hash-a-MODIFIED' } },
    });
    expect(planInvalidation(previous, current)).toEqual({ kind: 'content-changed', modifiedFiles: ['src/a.ts'] });
  });

  it('lists every modified file when more than one changed', () => {
    const previous = manifest();
    const current = manifest({
      files: {
        'src/a.ts': { hash: 'hash-a-MODIFIED' },
        'src/b.ts': { hash: 'hash-b-MODIFIED' },
      },
    });
    const plan = planInvalidation(previous, current);
    expect(plan.kind).toBe('content-changed');
    expect(plan.kind === 'content-changed' && plan.modifiedFiles.sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

});
