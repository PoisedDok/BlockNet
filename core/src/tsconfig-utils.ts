// Shared JSONC-safe tsconfig.json reader, used by both blocks/workspaces.ts (project
// references) and edges/depcruise-runner.ts (path aliases) — factored out so the
// parse-error-degrades-to-warning behavior (see docs/planning/PROGRESS.md's Task 2 entry)
// can't drift between the two call sites.
import { existsSync, readFileSync } from 'node:fs';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import type { Logger } from './log.js';

/**
 * Best-effort JSONC parse of `tsconfigPath`. Returns `undefined` if the file doesn't exist
 * or fails to parse entirely. A partial parse error (e.g. a stray comma in an unrelated part
 * of the file) still returns the best-effort recovered tree — bailing on any error would
 * silently downgrade unrelated, still-valid fields (`references`, `paths`) over a typo
 * nowhere near them.
 */
export function readTsconfigJsonc(tsconfigPath: string, logger: Logger): unknown {
  if (!existsSync(tsconfigPath)) return undefined;
  try {
    const errors: ParseError[] = [];
    const parsed = parseJsonc(readFileSync(tsconfigPath, 'utf-8'), errors, { allowTrailingComma: true });
    if (errors.length > 0) {
      logger.warn(`${tsconfigPath}: JSONC parse produced ${errors.length} error(s), best-effort recovery used`);
    }
    return parsed;
  } catch {
    logger.warn(`${tsconfigPath}: failed to parse, skipping`);
    return undefined;
  }
}
