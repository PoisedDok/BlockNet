# Architecture — Repo Standards

What makes this repo premium: root cleanliness, packaging discipline, and OSS credibility.
Binding, not aspirational — Task 10 (package & publish) verifies against this file.

## Root — nothing that isn't load-bearing

```
BlockNet/
├── package.json          # workspaces root only — no scripts that belong to a package
├── package-lock.json     # single lockfile, single package manager (npm), committed
├── tsconfig.base.json    # the only shared compiler config; packages extend, never duplicate
├── eslint.config.js       # flat config, single source, includes the no-vscode-in-core rule
├── .editorconfig
├── .gitignore
├── .nvmrc                 # pins Node LTS; CI and README both read from it, not a hardcode
├── LICENSE                 # MIT — required for Marketplace/OpenVSX credibility, see decisions/0010
├── README.md               # badges (build, marketplace version, license), GIF, quick start
├── CHANGELOG.md            # one entry per release, Keep-a-Changelog format
├── CONTRIBUTING.md         # how to run the F5 dev host, how tests work, PR expectations
├── .github/{workflows/ci.yml, dependabot.yml}
├── .vscode/{launch.json, extensions.json}
├── docs/
├── core/
├── extension/
└── design_handoff_blocknet_extension/   # reference only, see docs/architecture/DIRECTORY-TREE.md
```

No stray config at root beyond this list. A new root-level file is a smell — it belongs in
`core/`, `extension/`, or `docs/`.

A local-only `agent-skills/` directory (vendored coding-agent tooling, not BlockNet source)
may exist on disk — it's `.gitignore`d and never committed, linted, built, or shipped.

## Packaging discipline

- **`extension/.vscodeignore`** excludes `src/**` (only `dist/` ships), `webview/src/**`
  (only `webview/dist/` ships), and all `test/**`. The repo-root
  `design_handoff_blocknet_extension/` reference material never enters the `.vsix` at all —
  it isn't inside `extension/`, so this is automatic, not a config line. Verify at Task 10
  anyway (`vsce ls` before publish).
- **`extension/package.json` manifest fields**: `publisher`, `repository`, `bugs`,
  `keywords`, `categories`, `icon` (128×128 PNG at `extension/media/icon.png`),
  `galleryBanner`, `engines.vscode` pinned to a real tested minimum, `activationEvents`
  minimal per [ENGINEERING-CONSTRAINTS.md](./ENGINEERING-CONSTRAINTS.md).
- **Bundle budget**: the extension host bundle (esbuild, `vscode` external, minified) must
  stay small enough that activation is imperceptible — measured, not guessed, at Task 10.
  The webview bundle (React + React Flow + dagre) loads once per panel open, not per
  keystroke, so its budget is looser; code-split only if it actually grows past a size that
  makes first paint sluggish.

## CI — one pipeline, four gates

`npm ci` (cached) → `build --workspaces` → `test --workspaces` → `lint`. All four block
merge. `no-vscode-import.test.ts` runs inside `test`, not as a separate step — it's a unit
test, not a special case.

## What "premium" explicitly does not mean here

No changesets/monorepo-release tooling (single extension ships as one version; `core` is
not independently published in v1), no commit-message linting or git hooks (process
overhead the plan didn't ask for), no telemetry (banned outright, see
[decisions/0010](../decisions/0010-free-oss-distribution.md)). Premium means disciplined
and small, not maximal tooling.
