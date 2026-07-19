import { describe, expect, it } from 'vitest';
import { isWithinRoot } from '../src/path-utils.js';

describe('isWithinRoot', () => {
  it('accepts an ordinary relative path', () => {
    expect(isWithinRoot('packages/a/src/index.ts')).toBe(true);
    expect(isWithinRoot('index.ts')).toBe(true);
  });

  it('rejects the empty string (the root itself, not a valid path)', () => {
    expect(isWithinRoot('')).toBe(false);
  });

  it('rejects a bare ".."', () => {
    expect(isWithinRoot('..')).toBe(false);
  });

  it('rejects any path starting with a "../" segment, at any depth', () => {
    expect(isWithinRoot('../shared/utils.ts')).toBe(false);
    expect(isWithinRoot('../../../etc/passwd')).toBe(false);
  });

  it('rejects an absolute path', () => {
    expect(isWithinRoot('/etc/passwd')).toBe(false);
  });

  it('does not false-positive on a segment that merely starts with two dots', () => {
    expect(isWithinRoot('..hidden/file.ts')).toBe(true);
    expect(isWithinRoot('src/..config/file.ts')).toBe(true);
  });
});
