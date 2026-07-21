// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

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
  {
    // extension/webview/ — the browser-side React app (docs/decisions/0007). Single
    // source of truth for lint config (REPO-STANDARDS.md); no per-package eslint config.
    // No jsx-a11y: doesn't yet support eslint 10's peer range — a11y is handled by hand
    // (semantic markup, ARIA, keyboard handlers) and checked in review instead.
    files: ['extension/webview/src/**/*.{ts,tsx}', 'extension/webview/test/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
