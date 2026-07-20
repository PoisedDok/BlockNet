import { fork } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkerMessage, WorkerRequest } from '../src/ipc-worker.js';

// Exercises the built worker (docs/architecture/PROCESS-BOUNDARY.md's ipc-worker.ts contract)
// via a real forked child process and its real IPC channel — not an in-process import — the
// same black-box posture cli.test.ts takes toward cli.ts, because the process boundary itself
// (structured process.send/on('message'), not stdout parsing) is exactly the thing under test.
const workerPath = resolve(import.meta.dirname, '../dist/ipc-worker.js');

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-ipc-worker-test-'));
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

/** Forks the real worker, sends one request, and collects every message up to and including
 * the first 'result' or 'error', then kills the worker — mirroring the one-shot fork → one
 * message in → one message out → kill lifecycle ADR-0011 specifies (analysis-runner.ts, not
 * the worker itself, is responsible for the kill). */
async function runWorker(request: WorkerRequest): Promise<WorkerMessage[]> {
  const child = fork(workerPath, [], { stdio: 'pipe' });
  const messages: WorkerMessage[] = [];

  try {
    return await new Promise<WorkerMessage[]>((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error('worker did not respond within 5s')), 5000);
      child.on('message', (message: WorkerMessage) => {
        messages.push(message);
        if (message.type === 'result' || message.type === 'error') {
          clearTimeout(timeout);
          resolvePromise(messages);
        }
      });
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.send(request);
    });
  } finally {
    child.kill();
  }
}

describe('ipc-worker', () => {
  it('has been built', async () => {
    const { existsSync } = await import('node:fs');
    expect(existsSync(workerPath), 'run `npm run build --workspace=core` first').toBe(true);
  });

  it('runs analyze() and sends a result message with a schema-valid GraphResult', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'worker-test-repo' }));
    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');

    const messages = await runWorker({ rootDir: root });
    const result = messages.at(-1);

    expect(result?.type).toBe('result');
    if (result?.type === 'result') {
      expect(result.graph.meta.fileCount).toBe(2);
      expect(Array.isArray(result.graph.blocks)).toBe(true);
    }
  });

  it('sends progress messages for all four phases before the result', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'worker-test-repo' }));
    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');

    const messages = await runWorker({ rootDir: root });
    const progressPhases = messages.filter((m) => m.type === 'progress').map((m) => (m.type === 'progress' ? m.phase : null));

    expect(progressPhases).toEqual(['blocks', 'edges', 'risks', 'cache']);
    expect(messages.at(-1)?.type).toBe('result');
  });

  it('relays cacheDir through to analyze() so a second run reports a cache hit', async () => {
    const root = createTempRepo();
    writeText(resolve(root, 'package.json'), JSON.stringify({ name: 'worker-test-repo' }));
    writeText(resolve(root, 'src/pkgA/index.ts'), 'export const a = 1;\n');
    const cacheDir = resolve(root, '.cache');

    await runWorker({ rootDir: root, cacheDir });
    const second = await runWorker({ rootDir: root, cacheDir });
    const result = second.at(-1);

    expect(result?.type).toBe('result');
    if (result?.type === 'result') {
      expect(result.graph.meta.cacheHit).toBe(true);
    }
  });

  it('sends an error message (not an uncaught crash) when analyze() rejects', async () => {
    const nonExistentRoot = resolve(tmpdir(), 'blocknet-ipc-worker-test-does-not-exist');

    const messages = await runWorker({ rootDir: nonExistentRoot });
    const last = messages.at(-1);

    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(typeof last.message).toBe('string');
      expect(last.message.length).toBeGreaterThan(0);
    }
  });
});
