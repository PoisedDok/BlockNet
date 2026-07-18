import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/decisions/0002-portable-core-zero-vscode-deps.md: core/ must have zero VS Code
// dependencies. Belt-and-suspenders alongside the eslint no-restricted-imports rule
// (eslint.config.js) — this test is the one CI can't skip.
describe('core has no vscode import', () => {
  const files = globSync('src/**/*.ts', { cwd: resolve(import.meta.dirname, '..') });

  it.each(files)('%s does not import vscode', (file) => {
    const contents = readFileSync(resolve(import.meta.dirname, '..', file), 'utf-8');
    expect(contents).not.toMatch(/from\s+['"]vscode['"]/);
    expect(contents).not.toMatch(/require\(\s*['"]vscode['"]\s*\)/);
  });
});
