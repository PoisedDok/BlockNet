#!/usr/bin/env node
import { resolve } from 'node:path';
import { analyze } from './analyze.js';
import type { Progress } from './types.js';

// Terminal/CI entrypoint. Thin adapter over analyze() — contains no analysis logic itself
// (docs/architecture/PROCESS-BOUNDARY.md). Contract: `blocknet analyze <path> [--json]
// [--cache-dir <dir>]` — human-readable progress + summary on stdout by default, or a
// single JSON GraphResult blob on stdout when --json is passed. Unrecognized flags, a
// missing path, or a flag missing its value are hard errors, not silently ignored —
// this parsing contract is the precedent ipc-worker.ts's message contract (Task 5)
// inherits, so it needs to fail loudly here first.
class CliUsageError extends Error {}

type ParsedArgs = { rootDir: string; json: boolean; cacheDir: string | undefined };

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== 'analyze') {
    throw new CliUsageError(command === undefined ? 'missing command' : `unknown command: ${command}`);
  }

  let rootDir: string | undefined;
  let json = false;
  let cacheDir: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) break; // unreachable given the loop bound; satisfies noUncheckedIndexedAccess

    if (arg === '--json') {
      json = true;
    } else if (arg === '--cache-dir') {
      const value = rest[++i];
      if (value === undefined || value.startsWith('-')) {
        throw new CliUsageError('--cache-dir requires a directory value');
      }
      cacheDir = value;
    } else if (arg.startsWith('-')) {
      throw new CliUsageError(`unknown option: ${arg}`);
    } else if (rootDir === undefined) {
      rootDir = arg;
    } else {
      throw new CliUsageError(`unexpected argument: ${arg}`);
    }
  }

  if (rootDir === undefined) {
    throw new CliUsageError('missing <path>');
  }

  return { rootDir, json, cacheDir };
}

function printProgress(p: Progress) {
  process.stdout.write(`[${p.phase}] ${p.done}/${p.total}\n`);
}

const USAGE = 'Usage: blocknet analyze <path> [--json] [--cache-dir <dir>]';

async function main() {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n${USAGE}\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const { rootDir: rootDirArg, json, cacheDir } = parsed;
  const rootDir = resolve(process.cwd(), rootDirArg);
  const result = await analyze({
    rootDir,
    ...(cacheDir !== undefined && { cacheDir }),
    ...(!json && { onProgress: printProgress }),
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    const { blocks, edges, risks, meta } = result;
    process.stdout.write(
      `Analyzed ${meta.fileCount} file(s) in ${meta.durationMs}ms → ` +
        `${blocks.length} block(s), ${edges.length} edge(s), ${risks.length} risk(s)\n`,
    );
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
