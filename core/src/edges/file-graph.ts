// Normalizes dependency-cruiser's module graph into FileEdge[] (docs/architecture/
// DATA-MODEL.md) — the pre-aggregation granularity block-aggregate.ts consumes.
//
// dependency-cruiser's IDependency carries no line number or statement text (verified: its
// type has neither field, see docs/planning/PROGRESS.md's Task 3 entry) — only the
// specifier string as it appeared in source (`module`, e.g. `'./helpers.js'`) and the
// resolved target. Evidence is recovered here with a lightweight source-line scan for that
// literal specifier, rather than a second full AST pass — dependency-cruiser already did
// the hard part (alias/barrel/workspace resolution); this only needs to locate text that's
// already known to exist verbatim in the file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ICruiseResult, IModule } from 'dependency-cruiser';
import { createLogger, type Logger } from '../log.js';
import { isWithinRoot } from '../path-utils.js';
import type { FileEdge } from '../types.js';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the first line in `source` that both looks like an import/export/require and
 * contains `specifier` quoted with `'`, `"`, or `` ` ``, ignoring `/* ... *\/` block-comment
 * regions — a commented-out import (a common refactor-in-progress pattern, no leading `*`
 * required on continuation lines) is real text that satisfies the same match but is not a
 * real import, and misattributing evidence to it would point a future "jump to evidence"
 * click at the wrong line. Returns `undefined` in the practically-unreachable case of a
 * resolved specifier with no matching *active* literal in its own source file — callers
 * must not fabricate a fallback location, since evidence exists precisely so it can be
 * trusted as real (docs/PRINCIPLES.md).
 */
function findImportEvidence(source: string, specifier: string): { line: number; statement: string } | undefined {
  const quoted = new RegExp(`['"\`]${escapeRegExp(specifier)}['"\`]`);
  const lines = source.split('\n');

  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
      inBlockComment = true;
      continue;
    }

    const looksLikeImport =
      trimmed.startsWith('import') || trimmed.startsWith('export') || /\brequire\s*\(/.test(trimmed);
    if (looksLikeImport && quoted.test(line)) {
      return { line: i + 1, statement: trimmed };
    }
  }

  return undefined;
}

function fileEdgesForModule(mod: IModule, rootDir: string, logger: Logger): FileEdge[] {
  const localDependencies = mod.dependencies.filter(
    (dep) => !dep.coreModule && !dep.couldNotResolve && isWithinRoot(dep.resolved),
  );
  if (localDependencies.length === 0) return [];

  // A file can vanish between dependency-cruiser's scan and this read — a real race under
  // the file-watcher-driven re-analysis this engine is built for (docs/architecture/
  // FLOWS.md's incremental flow), not a hypothetical one. Degrade to "no edges from this
  // file" rather than crash the whole analysis, matching blocks/'s established
  // degrade-gracefully convention (docs/planning/PROGRESS.md's Task 2 entry).
  let source: string;
  try {
    source = readFileSync(join(rootDir, mod.source), 'utf-8');
  } catch {
    logger.warn(`${mod.source}: could not be read for evidence lookup, skipping its edges`);
    return [];
  }

  const edges: FileEdge[] = [];
  for (const dep of localDependencies) {
    const evidence = findImportEvidence(source, dep.module);
    if (!evidence) continue;
    edges.push({ sourceFile: mod.source, targetFile: dep.resolved, ...evidence });
  }
  return edges;
}

export function buildFileGraph(cruiseResult: ICruiseResult, rootDir: string, logger: Logger = createLogger()): FileEdge[] {
  return cruiseResult.modules.flatMap((mod) => fileEdgesForModule(mod, rootDir, logger));
}
