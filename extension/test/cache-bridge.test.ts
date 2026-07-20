import { describe, expect, it } from 'vitest';
import { resolveCacheDir } from '../src/cache-bridge.js';

describe('resolveCacheDir', () => {
  it('returns storageUri.fsPath when a workspace is open', () => {
    expect(resolveCacheDir({ storageUri: { fsPath: '/tmp/some-workspace/.blocknet-cache' } })).toBe(
      '/tmp/some-workspace/.blocknet-cache',
    );
  });

  it('throws when storageUri is undefined (no open workspace)', () => {
    expect(() => resolveCacheDir({ storageUri: undefined })).toThrow(/without an open workspace/);
  });
});
