# Changelog

All notable changes to `otelcol-lang` (the VS Code extension + language
server) are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- JetBrains plugin build bumps `org.jetbrains.kotlin.jvm` to 2.4.0 and
  `org.jetbrains.intellij.platform` to 2.16.0. The deprecated
  `instrumentationTools()` dependency is removed as required by the
  new platform plugin version.
- `.envrc` is now excluded from git, the npm tarball, and the `.vsix`
  bundle so per-developer direnv environment files cannot leak into
  published artifacts.
- Package renamed from `vscode-otelcol` to `opentelemetry-collector-config`
  across `package.json`, `package-lock.json`, all editor READMEs, the
  JetBrains plugin display name, and the VS Code integration test
  extension IDs. The npm tarball, `.vsix` filename, and JetBrains plugin
  label all follow the new name.

### Added
- Marketplace/plugin icon for both the VS Code extension and the
  JetBrains plugin, sourced from `docs/assets/otel-logo.png` (referenced
  via `package.json#icon`) and `editors/jetbrains/src/main/resources/META-INF/pluginIcon.png`.
- Confmap substitution highlighting for `${env:VAR}`,
  `${env:VAR:-default}` and `${file:path}` expressions in collector
  YAML, plus the legacy bare `${VAR}` form rendered as deprecated
  (strikethrough). Implemented as a TextMate injection grammar
  (`syntaxes/otelcol-substitution.injection.json`) so it fires inside
  both quoted and unquoted YAML scalars without disturbing the host
  grammar. Default token colours ship under
  `editor.tokenColorCustomizations` using descendant selectors, so the
  injection paints consistently even when YAML pushes its
  plain-scalar string scope onto the stack.
- `examples/env-vars/otelcol-config.yaml` exercises every supported
  substitution form (env, env-with-default, file, legacy) for quick
  visual verification in the dev host.
- Tokenizer regression suite `test/unit-grammar.test.mjs` runs through
  `vscode-textmate` + `vscode-oniguruma` to assert scope stacks across
  the full `otelcol-yaml` grammar — confmap substitutions, OTTL block
  sequences (`statements:`, `conditions:`, …), inline `condition:` /
  `statement:` scalars, embedded OTTL primitives (editor & converter
  functions, enums, paths, comparison/logical/where keywords, numeric
  literals, booleans, nil, comments) and the env-var injection
  composing inside embedded OTTL. Wired into `make test-unit`.
- New `otelcol.sniffer.trace` setting. When enabled, the sniffer logs
  per-file YAML → `otelcol` retag decisions (which rule matched, which
  siblings were scanned, why a file did or did not retag) to the
  "Otelcol Sniffer" output channel. Useful for diagnosing why a
  configset fragment is or isn't being detected as a collector config.
- `test/configsets/blank-line-anchor/` fixture exercising the anchor
  detection regression below.

### Fixed
- Anchor detection no longer rejects files that contain a blank line
  inside the top-level `service:` block (between e.g. `telemetry:` and
  `pipelines:`). The previous regex-based check silently broke
  multi-file configsets — neither the extension-side sniffer nor the
  server-side `ConfigSetIndex` would classify such a file as an
  anchor, leaving every sibling fragment ungrouped and every pipeline
  component reference (`memory_limiter`, etc.) flagged as undefined.
  Both layers now parse YAML structurally via `yaml.parseDocument` and
  share a single classifier at `src/common/yaml-classify.ts`, so the
  rule cannot drift between extension and server again.
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
