import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Exercises the built CLI (docs/architecture/PROCESS-BOUNDARY.md's `cli.ts` contract), not
// the TS source — `core/package.json`'s `pretest` script always rebuilds first.
const cliPath = resolve(import.meta.dirname, '../dist/cli.js');

const tempDirs: string[] = [];
function createTempRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'blocknet-cli-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function runCli(args: string[]) {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], { encoding: 'utf-8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number | null; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

describe('blocknet analyze CLI', () => {
  it('has been built', () => {
    expect(existsSync(cliPath), 'run `npm run build --workspace=core` first').toBe(true);
  });

  it('emits a schema-valid GraphResult as JSON with --json', () => {
    const emptyRepo = createTempRepo();
    const { stdout } = runCli(['analyze', emptyRepo, '--json']);

    const result = JSON.parse(stdout);
    expect(result).toMatchObject({
      blocks: [],
      edges: [],
      risks: [],
      meta: {
        fileCount: 0,
        cacheHit: false,
      },
    });
    expect(typeof result.meta.analyzedAt).toBe('string');
    expect(typeof result.meta.durationMs).toBe('number');
  });

  it('prints progress lines followed by a human-readable summary without --json', () => {
    const emptyRepo = createTempRepo();
    const { stdout } = runCli(['analyze', emptyRepo]);

    expect(() => JSON.parse(stdout)).toThrow();
    expect(stdout).toMatch(/^\[blocks] \d+\/4\n\[edges] \d+\/4\n\[risks] \d+\/4\n\[cache] \d+\/4\n/);
    expect(stdout).toMatch(/Analyzed \d+ file\(s\)/);
  });

  it('errors on a missing path instead of silently accepting a flag as the path', () => {
    const { status, stderr } = runCli(['analyze', '--json']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/missing <path>/);
  });

  it('errors on an unknown flag instead of silently ignoring it', () => {
    const emptyRepo = createTempRepo();
    const { status, stderr } = runCli(['analyze', emptyRepo, '--jason']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/unknown option: --jason/);
  });

  it('errors when --cache-dir is missing its value instead of silently dropping it', () => {
    const emptyRepo = createTempRepo();
    const { status, stderr } = runCli(['analyze', emptyRepo, '--cache-dir']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/--cache-dir requires a directory value/);
  });

  it('errors when --cache-dir swallows the next flag as its value', () => {
    const emptyRepo = createTempRepo();
    const { status, stderr } = runCli(['analyze', emptyRepo, '--cache-dir', '--json']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/--cache-dir requires a directory value/);
  });
});
