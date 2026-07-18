// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // design_handoff_blocknet_extension/ is reference-only, never linted/shipped
    // (docs/architecture/REPO-STANDARDS.md). agent-skills/ is a vendored tooling
    // directory, not BlockNet source.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'design_handoff_blocknet_extension/**',
      'agent-skills/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // core/ has zero VS Code dependencies (docs/decisions/0002) — belt-and-suspenders
    // alongside core/test/no-vscode-import.test.ts.
    files: ['core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'vscode', message: 'core/ must have zero VS Code dependencies — see docs/decisions/0002.' }] }],
    },
  },
);
