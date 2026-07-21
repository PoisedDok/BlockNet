import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalysisRunner } from '../src/analysis-runner.js';

// The real, already-built worker (esbuild.config.ts copies it from @blocknet/core's own
// build) — exercised black-box, mirroring core/test/ipc-worker.test.ts's own posture.
const WORKER_PATH = resolve(import.meta.dirname, '../dist/ipc-worker.mjs');

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-analysis-runner-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function writeText(path: string, contents: string) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

describe('AnalysisRunner', () => {
  it('runs a real analyze() via the forked worker and resolves with a success outcome', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));
    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');

    const runner = new AnalysisRunner(WORKER_PATH);
    const { result } = runner.run({ rootDir: root });
    const outcome = await result;

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.graph.meta.fileCount).toBe(2);
    }
  });

  it('reports progress for all four phases via onProgress', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));
    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');

    const phases: string[] = [];
    const runner = new AnalysisRunner(WORKER_PATH);
    const { result } = runner.run({ rootDir: root, onProgress: (p) => phases.push(p.phase) });
    await result;

    expect(phases).toEqual(['blocks', 'edges', 'risks', 'cache']);
  });

  it('never delivers onProgress for a run superseded by a newer one before it started (FLOWS.md §2a)', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));
    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');

    const runner = new AnalysisRunner(WORKER_PATH);
    const staleEvents: string[] = [];
    const first = runner.run({ rootDir: root, onProgress: (p) => staleEvents.push(p.phase) });
    // Started synchronously right after — by the time first's forked worker has sent even its
    // first progress message, first's generation is already superseded.
    const second = runner.run({ rootDir: root });

    await Promise.all([first.result, second.result]);

    expect(staleEvents).toEqual([]);
  });

  it('resolves with an error outcome (not a hang or a throw) for a nonexistent rootDir', async () => {
    const nonExistentRoot = resolve(tmpdir(), 'blocknet-analysis-runner-test-does-not-exist');
    const runner = new AnalysisRunner(WORKER_PATH);
    const { result } = runner.run({ rootDir: nonExistentRoot });
    const outcome = await result;

    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });

  it('assigns strictly increasing generation ids across successive run() calls', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));

    const runner = new AnalysisRunner(WORKER_PATH);
    const first = runner.run({ rootDir: root });
    const second = runner.run({ rootDir: root });

    expect(second.generation).toBeGreaterThan(first.generation);
    await Promise.all([first.result, second.result]);
  });

  it('isLatest() is false for a run superseded by a newer one, even after the older run finishes', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));

    const runner = new AnalysisRunner(WORKER_PATH);
    const first = runner.run({ rootDir: root });
    const second = runner.run({ rootDir: root });

    await first.result;
    expect(runner.isLatest(first.generation)).toBe(false);
    expect(runner.isLatest(second.generation)).toBe(true);

    await second.result;
  });

  it('isLatest() is true for the only run issued so far', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));

    const runner = new AnalysisRunner(WORKER_PATH);
    const { generation, result } = runner.run({ rootDir: root });

    expect(runner.isLatest(generation)).toBe(true);
    await result;
    expect(runner.isLatest(generation)).toBe(true);
  });

  it('dispose() kills in-flight workers without throwing', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));

    const runner = new AnalysisRunner(WORKER_PATH);
    runner.run({ rootDir: root });
    expect(() => runner.dispose()).not.toThrow();
  });

  it('runMicro() resolves with a real block\'s file-level graph', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));
    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');
    const cacheDir = resolve(root, '.cache');

    const runner = new AnalysisRunner(WORKER_PATH);
    await runner.run({ rootDir: root, cacheDir }).result;

    const { result } = runner.runMicro({ rootDir: root, cacheDir, blockId: 'src/pkgA' });
    const outcome = await result;

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.micro.blockId).toBe('src/pkgA');
      expect(outcome.micro.files.map((f) => f.id)).toEqual(['src/pkgA/index.ts']);
    }
  });

  it('runMicro() resolves with an error outcome when no cache exists for that dir', async () => {
    const root = createTempRepo();
    const cacheDir = resolve(root, '.cache-never-written');

    const runner = new AnalysisRunner(WORKER_PATH);
    const { result } = runner.runMicro({ rootDir: root, cacheDir, blockId: 'src/pkgA' });
    const outcome = await result;

    expect(outcome.kind).toBe('error');
  });

  it('runMicro()\'s generation counter is independent of run()\'s macro generation counter', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));
    const cacheDir = resolve(root, '.cache');

    const runner = new AnalysisRunner(WORKER_PATH);
    await runner.run({ rootDir: root, cacheDir }).result;
    // Two more macro runs bump #latestGeneration to 3 — the micro stream must not have moved.
    await runner.run({ rootDir: root, cacheDir }).result;
    await runner.run({ rootDir: root, cacheDir }).result;

    const { generation, result } = runner.runMicro({ rootDir: root, cacheDir, blockId: 'src/pkgA' });
    expect(generation).toBe(1);
    expect(runner.isLatestMicro(generation)).toBe(true);
    await result;
  });

  it('isLatestMicro() is false for a micro run superseded by a newer one', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'runner-test-repo' }));
    const cacheDir = resolve(root, '.cache');

    const runner = new AnalysisRunner(WORKER_PATH);
    await runner.run({ rootDir: root, cacheDir }).result;

    const first = runner.runMicro({ rootDir: root, cacheDir, blockId: 'src/pkgA' });
    const second = runner.runMicro({ rootDir: root, cacheDir, blockId: 'src/pkgA' });

    await Promise.all([first.result, second.result]);
    expect(runner.isLatestMicro(first.generation)).toBe(false);
    expect(runner.isLatestMicro(second.generation)).toBe(true);
  });
});
