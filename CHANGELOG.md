# Changelog

All notable changes to `otelcol-lang` (the VS Code extension + language
server) are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `.vscodeignore` now excludes dev-only files (`Makefile`,
  `tsconfig.test.json`, `.vscode-test.mjs`, `.oxlintrc.json`,
  `.oxfmtrc.json`, `.editorconfig`, `.gitignore`, `NEXT-TASKS`,
  `RELEASE_BUCKETS.md`) that were previously shipping inside the
  published `.vsix`. The bundle now contains only the manifest,
  README, LICENSE, NOTICE, CHANGELOG, grammars, language config,
  and the compiled `dist/`.

### Changed
- Build is now driven from the Makefile. CLI tooling
  (`oxlint`, `oxfmt`, `vsce`, `typescript`, `@vscode/test-cli`) is
  version-pinned at the top of the Makefile and invoked via
  `npx --package=<name>@$(VAR) <bin>`, so version bumps are explicit
  rather than picked up through `devDependencies` ranges. Run
  `make check-versions` to see pinned vs. latest releases on npm.
  `make publish-patch/minor/major` bumps and publishes in one step.
- `package.json` scripts reduced from 24 to 3 (`watch`, `compile`,
  `smoke` remain for local dev). `devDependencies` reduced from 11
  to 5 — CLI-only tools (`oxlint`, `oxfmt`, `typescript`,
  `@vscode/vsce`, `mocha`) no longer appear there; the Makefile's
  `npx --package=` pins are the source of truth.

## [0.1.0] — 2026-05-31

Initial release.

### Added
- VS Code extension client (`src/extension/`) with automatic
  YAML→`otelcol` language detection (first-line comment or filename
  pattern).
- Language server (`src/server/`, 11 modules) providing:
  - YAML model parsing with anchor/alias tracking.
  - Config-set discovery (auto-scan via `service.pipelines:` anchors,
    or explicit `otelcol-configset.yaml` sidecar / first-line
    `# otelcol-configset:` directive).
  - Pipeline graph validation: undefined refs, ambiguous refs,
    defined-but-unused components, signal compatibility.
  - Component-aware hover with signals, stability, codeowners,
    warnings, feature gates and descriptions sourced from upstream
    `metadata.yaml`.
  - Completion for component types and pipeline references.
  - Semantic tokens (component IDs, namespaces, deprecation marking).
  - OTTL forwarding to an optional `ottl-lsp` subprocess for embedded
    OTTL diagnostics.
- TextMate grammars (`syntaxes/`) for `otelcol` YAML with OTTL
  language injection into OTTL-bearing keys.
- JSON Schemas + per-distribution component indexes vendored under
  `schemas/` (snapshot from `otelery/otelcol-schemas`); copied next
  to the compiled server at build time by `scripts/copy-schemas.mjs`
  so clone-and-build works with no external dependency.
- Reserved `otelcol.schemaSource` setting for future HTTPS / release-
  tag schema fetching (no effect in v0.1.0).
- User-facing settings for distribution choice, config-set discovery,
  optional contrib path, OTTL LSP path, and LSP trace verbosity.
- Full LSP fixture suite (`test/`): simple single-file configs,
  complex multi-file production-shaped topology, and ~20 config-set
  fixtures covering discovery modes, duplicates, missing refs, and
  roadmap features.
