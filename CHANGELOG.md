# Changelog

All notable changes to `otelcol-lang` (the VS Code extension + language
server) are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- LSP completion expanded well beyond top-level component types
  (`src/server/completion.ts`): component-instance property suggestions
  walk the component's JSON Schema along the trailing path and offer
  schema-derived `detail` (type label + required marker) plus markdown
  docs; pipeline-ref suggestions inside
  `service.pipelines.<sig>.{receivers,processors,exporters}`;
  pipeline-body bucket suggestions inside `service.pipelines.<sig>`;
  top-level keys (`receivers`, `processors`, …) at document root; and
  enum-value suggestions after `key: ` when the resolved schema has an
  `enum`. Hover's schema-markdown renderer is now shared with completion
  via new `formatSchemaPropertyMarkdown`, `schemaTypeLabel`,
  `lookupProperty`, `resolveRef` exports from `src/server/hover.ts`.
  `src/server/yaml-model.ts` adds `pathAtPosition` (indent-aware path
  resolver) and `siblingKeysAt(text, keyPath)` (duplicate-key filter
  source).
- `make test-vscode-packaged` runs the full VS Code Extension Host
  integration suite against the just-built `.vsix` instead of the
  in-tree source. It extracts the packaged extension into a tmp dir,
  exposes the path via `OTELCOL_PACKAGED_EXTENSION_DIR`, and points a
  new `editors/vscode/.vscode-test.packaged.mjs` config at it as
  `extensionDevelopmentPath`. If a runtime file ever drops out of the
  `.vsix` (e.g. a `.vscodeignore` regression that omits
  `dist/schemas/**` or a grammar), activation fails here even though
  `make test-vscode` stays green. 16 + 3 tests across both workspaces
  pass against the packaged form today.
- `OTELCOL_DEV_WATCH=1` opt-in dev loop, symmetric across the two heavy
  editors. VS Code: the extension installs an `fs.watch` on
  `dist/server/server.js` and calls `client.restart()` after a 300 ms
  debounce. JetBrains: new `OtelcolDevWatcher` (`ProjectActivity`)
  watches the resolved server path via NIO `WatchService`, debounces
  300 ms, and calls `LanguageServerManager.stop + start`. Pairs with
  `npm run watch` so editing TS source ends with a fresh LSP process
  inside ~1 s. Production installs are unaffected — both sides opt in
  explicitly.
- JetBrains sandbox dev loop. `build.gradle.kts` registers a
  `runIdeDev` task via `intellijPlatformTesting.runIde.register` that
  pins a current `runIdeVersion` (decoupled from compile-target
  `platformVersion`), pulls in LSP4IJ, opens `examples/` as the sandbox
  project, sets `-Dotelcol.lsp.server` at the source-tree
  `dist/server/server.js`, and pre-populates `config_runIdeDev/options/`
  with `trusted-paths.xml` and `log-categories.xml` (DEBUG for
  LSP4IJ + lsp4j, TRACE for our packages). New Make target
  `runide-jetbrains` chains `bundle` → `gradle runIdeDev`; a matching
  "Run JetBrains Sandbox" VS Code launch entry runs it from VS Code so
  cross-editor work doesn't need two terminals.
- JetBrains server-path override chain. `OtelcolLspServerFactory.buildCommand`
  resolves in priority order: `-Dotelcol.lsp.command` (full argv0) →
  `-Dotelcol.lsp.server` (system property, dev-only) →
  `otelcol.lsp.server.path` (Registry key, persistent across IDE
  restarts) → bundled+extracted. The Registry key is declared in
  `plugin.xml` so users can edit it via Help → Find Action → Registry…
- JetBrains one-click restart: new `RestartOtelcolServerAction`
  (`DumbAwareAction` under Tools) calls the same `stop + start` cycle as
  the watcher — useful when the watcher is off or when forcing a clean
  re-init.
- JetBrains hash-invalidated bundle cache. `extractBundledServer`
  compares a `manifest.sha256` sidecar produced by the
  `copyLanguageServer` Gradle task against a `.content.sha256` stamp
  under `~/.cache/JetBrains/<IDE>/otelcol-language-server/<version>/`;
  mismatch re-extracts. Reinstalling a freshly-built plugin no longer
  requires manually wiping the cache dir.
- JetBrains Node discovery via shell PATH.
  `OtelcolLspServerFactory.resolveNode` uses
  `PathEnvironmentVariableUtil.findInPath` against
  `EnvironmentUtil.getValue("PATH")` so GUI-launched IDEs on macOS/Linux
  find `node` from Homebrew / nvm / `/usr/local/bin` instead of the
  launcher's stripped PATH.
- JetBrains completion shim for the LSP4IJ
  `AdjustIndentation`/`AsIs` gap. New `OtelcolLspCompletionFeature`
  overrides `createLookupElement`: when the item is a snippet whose
  insertText (or `textEdit.newText`) contains both `\n` and `\t`,
  continuation-line `\t` is rewritten to two spaces (`INDENT_UNIT`) and
  `InsertTextMode.AsIs` is pinned, so spec-idiomatic multi-line snippets
  render at the right column on JetBrains too. Wired via
  `OtelcolLspServerFactory.createClientFeatures()`. Becomes a no-op once
  the LSP4IJ upstream fix lands.
- Completion test layers. `test/unit-completion.test.mjs` defends the
  per-branch LSP item shape (component types, pipeline-body buckets,
  pipeline-ref IDs, schema-driven property keys, enum values, top-level
  keys, snippet-insertion invariants, intellij-shaped blank-line
  position, sibling-key carve-out, blank-line-after-array regression).
  `test/integration-completion.test.mjs` boots the bundled server over
  stdio and asserts schema-property and pipeline-body completion
  end-to-end. Editor-level post-acceptance buffer assertions land in
  both `editors/jetbrains/.../OtelcolCompletionTest.kt`
  (`BasePlatformTestCase` + real LSP4IJ) and
  `editors/vscode/test/integration/extension.test.ts`, with a shared
  `assertBufferEquals` formatter that visualises whitespace as `·` and
  newlines as `↵`.
- `docs/investigations/completion-improvements.md` documents the
  rationale and technical detail behind the five completion fixes
  (relative-`INDENT_UNIT` snippet bodies + `InsertTextMode.AsIs`,
  explicit `textEdit.range` pinning via `wordStartBefore`,
  sibling-key filter via `siblingKeysAt` with the `keyOnLine`
  carve-out, blank-line `pathAtPosition` fix, default-value pre-fill
  via `${1:default}`).
- README gains "Single server, multiple editors", "Completion
  contexts", "Configuration sets" and "Editor-side specifics" sections,
  plus a full writeup of the JetBrains plugin's server discovery,
  override channels, cache invalidation, Node.js resolution, and
  unified `OTELCOL_DEV_WATCH=1` dev loop.

### Changed
- VS Code packaging switched from a deny-list `.vscodeignore` to
  deny-by-default + explicit allow-list. The previous deny-list silently
  leaked any newly added top-level directory into the `.vsix` — `.idea/`
  (11 IntelliJ project files) and `docs/investigations/` (3 markdown
  writeups) had drifted into the published artifact unnoticed. The new
  form starts with `**` and whitelists only the files vsce does not
  auto-include (runtime bundles under `dist/`, JSON schemas, TextMate
  grammars, `editors/vscode/language-configuration.json`, the icon, and
  `LICENSE` + `CHANGELOG.md` — `package.json` and `README.md` are
  special-cased by vsce). vsce uses minimatch (not gitignore) semantics,
  so concrete files are whitelisted instead of bare directories.
- `editors/jetbrains/bin/` (Eclipse JDT compiler output) and
  `NEXT-TASKS` (personal scratch / WIP-tracking file) are now
  gitignored so opening the JetBrains plugin module in an Eclipse-based
  IDE no longer pollutes the working tree and contributors who keep
  local notes under that path get a clean `git status`.
- Docs reorg: `docs/intellij-lsp-node-plugins.md` and
  `docs/jetbrains-dev-loop.md` moved into `docs/investigations/`
  (point-in-time research notes — kept separate from user-facing
  release docs under `docs/dist/`). README, `editors/SHARED.md` and the
  `Makefile` help text are updated to multi-editor-parity phrasing
  ("shared by all editors", "VS Code, JetBrains, Helix, Zed") instead
  of treating VS Code as the reference point. Naming that's correctly
  VS-Code-specific (`editors/vscode/`, `.vscode-test.mjs`,
  `make test-vscode`, `vscode:prepublish`) was left alone.
- JetBrains Plugin Verifier `failureLevel` raised to include
  `COMPATIBILITY_PROBLEMS`, `MISSING_DEPENDENCIES`, and `NOT_DYNAMIC`
  so the `<depends>org.jetbrains.plugins.yaml</depends>` regression
  class is caught at CI time.

### Fixed
- JetBrains semantic-token references rendered as plain foreground
  (white in Darcula) because the non-declaration `class` token was
  mapped to `CLASS_REFERENCE`, whose default attributes are empty. Drop
  the declaration/reference split and map both to `CLASS_NAME` (and
  `namespace` to `INSTANCE_FIELD`), matching VS Code where declarations
  and references share a colour.
- VS Code `editors/vscode/language-configuration.json`
  `decreaseIndentPattern` (`^\s*$` → `^(?!.*)$`) so a blank line under
  a `key:` line no longer triggers the YAML grammar's bracket-pair
  indent-decrease — previously, typing a child key on a freshly-pressed
  Enter momentarily auto-outdented one level.
- Completion path resolution on blank lines.
  `pathAtPosition` was over-raising `cursorIndent` whenever
  `position.character <= lineLeading`, which collapsed the cursor's
  intended indent to match the preceding non-blank line — turning a
  cursor at col 4 below an `      - item` array entry into a col-6
  lookup that resolved inside the array (no properties → empty
  completion). The fallback now only fires when both the reported
  column and the line's existing whitespace are zero.
- Completion items pin an explicit `textEdit.range` to the typed
  identifier prefix via `wordStartBefore`. Without this, LSP4IJ widened
  the replacement range back through leading whitespace and the
  inserted key landed at column 0; vscode-languageclient stopped at the
  first non-identifier character and was fine without an explicit
  range. The explicit range makes both clients behave the same.
- Completion items ship `insertTextMode: InsertTextMode.AsIs` and carry
  only the *relative* `INDENT_UNIT` (two spaces) on continuation lines,
  so VS Code's `adjustIndentation` does not re-apply the cursor line's
  indent on top of ours. LSP4IJ also inserts verbatim, so the same body
  works there.
- Sibling-key filtering via `siblingKeysAt`: keys already present in
  the cursor's parent mapping are suppressed so accepting a suggestion
  can't create a YAML duplicate-key error. Exception: the key on the
  cursor's own line (`keyOnLine`) stays in the list so re-editing or
  replacing an existing key still surfaces it.

## [0.1.0] — 2026-06-09

Initial Marketplace / npm release. Published as
`otelery.opentelemetry-collector-config` on the VS Code Marketplace and
as `opentelemetry-collector-config` on npm.

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
- Marketplace/plugin icon for both the VS Code extension and the
  JetBrains plugin, sourced from `docs/assets/otel-logo.png` (referenced
  via `package.json#icon`) and
  `editors/jetbrains/src/main/resources/META-INF/pluginIcon.png`.
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
- `otelcol.sniffer.trace` setting. When enabled, the sniffer logs
  per-file YAML → `otelcol` retag decisions (which rule matched, which
  siblings were scanned, why a file did or did not retag) to the
  "Otelcol Sniffer" output channel. Useful for diagnosing why a
  configset fragment is or isn't being detected as a collector config.
- `test/configsets/blank-line-anchor/` fixture exercising the anchor
  detection regression fixed below.
- Distribution-specific READMEs under `docs/dist/`:
  `docs/dist/npm-readme.md` documents the
  `opentelemetry-collector-config` npm package (LSP install, transport
  flags, workspace settings, editor matrix); `docs/dist/vscode-readme.md`
  is the VS Code Marketplace listing (features, activation patterns,
  settings table). `make package-vscode`, `make publish-vscode` and
  `make publish-npm` swap the relevant file into place as `README.md`
  for the duration of the vsce/npm invocation and restore it via
  `trap`. `.vscodeignore` and `.npmignore` exclude `docs/dist/` so the
  swap-source files do not appear alongside the swapped-in `README.md`
  inside the artifacts.

### Changed
- Package renamed from `vscode-otelcol` to `opentelemetry-collector-config`
  across `package.json`, `package-lock.json`, all editor READMEs, the
  JetBrains plugin display name, and the VS Code integration test
  extension IDs. The npm tarball, `.vsix` filename, and JetBrains plugin
  label all follow the new name.
- `make publish` splits per editor: `publish-vscode`, `publish-npm`,
  `publish-jetbrains`, `publish-zed`, `publish-helix`. The top-level
  `publish` aggregates the two automated channels (vsce + npm) so the
  Marketplace listing and the `opentelemetry-collector-config` npm
  tarball — which ships the standalone `otelcol-language-server` binary
  used by Zed, Helix and the JetBrains plugin — stay in lockstep. The
  `publish-patch/minor/major` bump targets bump the version once via
  `npm version --no-git-tag-version` and then fan out to both channels.
- Helix, JetBrains and Zed READMEs replace the local `npm pack` install
  dance with `npm i -g opentelemetry-collector-config` now that the LSP
  is published to npm.
- JetBrains plugin build bumps `org.jetbrains.kotlin.jvm` to 2.4.0 and
  `org.jetbrains.intellij.platform` to 2.16.0. The deprecated
  `instrumentationTools()` dependency is removed as required by the
  new platform plugin version.
- `.envrc` is excluded from git, the npm tarball, and the `.vsix`
  bundle so per-developer direnv environment files cannot leak into
  published artifacts.
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
- `.vscodeignore` excludes dev-only files (`Makefile`,
  `tsconfig.test.json`, `.vscode-test.mjs`, `.oxlintrc.json`,
  `.oxfmtrc.json`, `.editorconfig`, `.gitignore`, `NEXT-TASKS`,
  `RELEASE_BUCKETS.md`) that were previously shipping inside the
  published `.vsix`. The bundle now contains only the manifest,
  README, LICENSE, NOTICE, CHANGELOG, grammars, language config,
  and the compiled `dist/`.
