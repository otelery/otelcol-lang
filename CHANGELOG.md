# Changelog

All notable changes to `otelcol-lang` (the VS Code extension + language
server) are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Schema integration shim (`scripts/sync-schemas.mjs`) pulling schemas
  from a sibling `otelcol-schemas` checkout at build time.
- Reserved `otelcol.schemaSource` setting for future HTTPS / release-
  tag schema fetching (no effect in v0.1.0).
- User-facing settings for distribution choice, config-set discovery,
  optional contrib path, OTTL LSP path, and LSP trace verbosity.
- Full LSP fixture suite (`test/`): simple single-file configs,
  complex multi-file production-shaped topology, and ~20 config-set
  fixtures covering discovery modes, duplicates, missing refs, and
  roadmap features.
