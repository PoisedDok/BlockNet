import { describe, expect, it } from 'vitest';
import { ChangeBuffer } from '../src/change-buffer.js';

describe('ChangeBuffer', () => {
  it('is empty when nothing has been recorded', () => {
    const buffer = new ChangeBuffer();
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.flush()).toEqual({ changedFiles: [] });
  });

  it('a pure content change flushes as a changedFiles array', () => {
    const buffer = new ChangeBuffer();
    buffer.record('change', 'src/pkgA/index.ts');
    buffer.record('change', 'src/pkgB/index.ts');

    expect(buffer.isEmpty).toBe(false);
    const trigger = buffer.flush();
    expect(trigger.changedFiles).toBeDefined();
    expect(new Set(trigger.changedFiles)).toEqual(new Set(['src/pkgA/index.ts', 'src/pkgB/index.ts']));
  });

  it('flush() clears state so a second flush is empty', () => {
    const buffer = new ChangeBuffer();
    buffer.record('change', 'src/pkgA/index.ts');
    buffer.flush();

    expect(buffer.isEmpty).toBe(true);
    expect(buffer.flush()).toEqual({ changedFiles: [] });
  });

  it('a create forces a full scan (no changedFiles), even alongside pure content edits', () => {
    const buffer = new ChangeBuffer();
    buffer.record('change', 'src/pkgA/index.ts');
    buffer.record('create', 'src/pkgA/new-file.ts');

    const trigger = buffer.flush();
    expect(trigger).toEqual({});
  });

  it('a delete forces a full scan (no changedFiles)', () => {
    const buffer = new ChangeBuffer();
    buffer.record('delete', 'src/pkgA/removed.ts');

    expect(buffer.flush()).toEqual({});
  });

  it('touching package.json anywhere in the tree forces a full scan, overriding everything else', () => {
    const buffer = new ChangeBuffer();
    buffer.record('change', 'packages/sub/package.json');
    buffer.record('change', 'src/pkgA/index.ts');

    expect(buffer.flush()).toEqual({});
  });

  it('touching tsconfig.json forces a full scan', () => {
    const buffer = new ChangeBuffer();
    buffer.record('change', 'tsconfig.json');

    expect(buffer.flush()).toEqual({});
  });

  it('a config change even via create/delete still classifies as config, not structural', () => {
    const buffer = new ChangeBuffer();
    buffer.record('create', 'apps/new-app/package.json');

    // Same outcome either way ({} — full scan), but this exercises that the config check
    // happens before the create/delete check, matching decisions/0008's priority order
    // (config-changed overrides structural-changed).
    expect(buffer.flush()).toEqual({});
  });

  it('excluded paths (node_modules, dot-directories, build output) are dropped entirely', () => {
    const buffer = new ChangeBuffer();
    buffer.record('change', 'node_modules/some-dep/index.js');
    buffer.record('create', 'dist/bundle.js');
    buffer.record('change', '.next/cache/foo.json');

    expect(buffer.isEmpty).toBe(true);
    expect(buffer.flush()).toEqual({ changedFiles: [] });
  });

  it('excluded package.json inside node_modules does not force a full scan', () => {
    const buffer = new ChangeBuffer();
    buffer.record('change', 'node_modules/some-dep/package.json');

    expect(buffer.isEmpty).toBe(true);
  });
});
