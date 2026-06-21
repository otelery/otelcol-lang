# Building, packaging & installing

How to build `otelcol-lang` from a checkout, run the test suites, produce per-editor distributables, install them locally, and refresh the vendored schemas. For the release/publish flow see [RELEASING.md](RELEASING.md); for how the pieces fit together see [ARCHITECTURE.md](ARCHITECTURE.md).

## Build

One-time setup:

```sh
make install        # npm install
make build          # tsc + copy schemas into out/ (powers unit tests)
make bundle         # esbuild → dist/extension + dist/server + dist/schemas
```

Common shared targets (run `make help` for the full list):

| target                    | does                                                     |
| ------------------------- | -------------------------------------------------------- |
| `make build`              | `tsc` + copy schemas into `out/` (for unit tests)        |
| `make bundle`             | production esbuild bundle into `dist/`                   |
| `make test-unit`          | LSP modules in isolation (node --test, fast)             |
| `make test-stdio`         | end-to-end LSP handshake over stdio (`bin/` smoke)       |
| `make test-editors`       | every per-editor suite + the stdio smoke                 |
| `make test`               | `test-unit` + `test-editors`                             |
| `make check`              | all quality gates (CI entry-point)                       |
| `make package`            | build every editor's distributable into `dist/packages/` |
| `npm run smoke -- <file>` | parse a yaml, print model + diagnostics                  |

### Per-editor build / test / package

| Editor    | Build                  | Test                                              | Package (writes to `dist/packages/`)                |
| --------- | ---------------------- | ------------------------------------------------- | --------------------------------------------------- |
| VS Code   | `make bundle`          | `make test-vscode`                                | `make package-vscode` → `.vsix`                     |
| Zed       | `make build-zed`       | `make test-zed`                                   | `make package-zed` → `.tar.gz` (WASM + config)      |
| Helix     | (config only)          | `make test-helix` / `make test-helix-integration` | `make package-helix` → `.tar.gz` (config + queries) |
| JetBrains | `make build-jetbrains` | `make test-jetbrains`                             | `make package-jetbrains` → plugin `.zip`            |

`make package` runs all four package targets at once.

## Build & test as a local package per editor

Every editor can be installed from the artefacts in `dist/packages/` without touching the Marketplace, JetBrains repository, or any other remote registry. The pattern is always: `make package-<editor>` → install the resulting file into the editor.

### VS Code

```sh
make package-vscode
# → dist/packages/opentelemetry-collector-config-<version>.vsix

# install into your local VS Code:
code --install-extension dist/packages/opentelemetry-collector-config-*.vsix
# or: Extensions view → "…" menu → "Install from VSIX…"
```

To iterate without packaging, run the extension straight from the checkout (no install needed):

```sh
make bundle
code --extensionDevelopmentPath="$(pwd)" examples/
```

### Zed

Zed's "Install Dev Extension" loads the source directory; it does not consume a packaged archive. Use it for iteration:

1. Open Zed → `Extensions` (`cmd/ctrl-shift-x`) → `Install Dev Extension` → pick `editors/zed/`.
2. Zed compiles the Rust crate to WASM and registers the language.

For a reproducible artefact (release WASM + config bundle) suitable for sharing or attaching to a release:

```sh
make package-zed
# → dist/packages/otelcol-zed-<version>.tar.gz
```

The Zed extension shells out to `otelcol-language-server` on `PATH`, so first install the server locally:

```sh
npm pack                                  # → opentelemetry-collector-config-<version>.tgz
npm i -g ./opentelemetry-collector-config-*.tgz           # exposes otelcol-language-server
which otelcol-language-server
```

### Helix

Helix has no plugin format; the "package" is a tarball of config and queries that the user extracts into `~/.config/helix/`:

```sh
make package-helix
# → dist/packages/otelcol-helix-<version>.tar.gz

# install:
tar xzf dist/packages/otelcol-helix-*.tar.gz -C ~/.config/helix/
```

The server also needs to be on `PATH` (same `npm i -g ./opentelemetry-collector-config-*.tgz` step as for Zed). See [`editors/helix/README.md`](../editors/helix/README.md) for the symlink-based dev variant that lets query edits flow through without re-packaging.

### JetBrains

```sh
make package-jetbrains
# → dist/packages/<plugin-id>-<version>.zip
```

Install in the IDE: `Settings → Plugins → ⚙ → Install Plugin from Disk…` → pick the `.zip`. The plugin depends on **LSP4IJ**, which the IDE will offer to install on first launch if it isn't already present. The bundled `server.js` is extracted from the plugin jar to `~/.cache/JetBrains/<IDE>/otelcol-language-server/<version>/`; the extraction is keyed by a content hash (`manifest.sha256`) so reinstalling a newer plugin invalidates the cache automatically; no manual `rm -rf` step. A `node` binary on the user's shell PATH is the only external dependency.

**Node discovery.** `OtelcolLspServerFactory.resolveNode()` uses `com.intellij.execution.configurations.PathEnvironmentVariableUtil.findInPath` against the shell-inherited PATH (`EnvironmentUtil.getValue("PATH")`), which is necessary because GUI-launched IDEs on macOS/Linux otherwise inherit a stripped PATH that excludes Homebrew, nvm, `/usr/local/bin`, etc. Falls back to the literal `"node"` if lookup fails.

**Server JS override channels** (priority order):

| Channel                              | Lifetime         | Use                                |
| ------------------------------------ | ---------------- | ---------------------------------- |
| `-Dotelcol.lsp.command="…"`          | Process lifetime | Full executable override; tests    |
| `-Dotelcol.lsp.server="…"`           | Process lifetime | Source-tree `server.js` during dev |
| `otelcol.lsp.server.path` (Registry) | Across restarts  | Persistent override on any IDE     |
| _(none)_                             | n/a              | Bundled extraction (production)    |

`-Dotelcol.lsp.node="…"` overrides the resolved Node binary independently.

**Sandbox IDE for plugin development:**

```sh
make runide-jetbrains
```

Bundles the server and launches a sandbox IntelliJ with `examples/` opened as the project and `-Dotelcol.lsp.server=…/dist/server/server.js` pre-wired. Override the project folder with `./gradlew -p editors/jetbrains runIde -PsandboxProject=$(realpath test)`.

**Auto-restart on rebuild.** Set the unified environment variable `OTELCOL_DEV_WATCH=1` to enable a file watcher on the active `server.js`. The JetBrains plugin's `OtelcolDevWatcher` `ProjectActivity` uses a NIO `WatchService` (300 ms debounce) and calls `LanguageServerManager.stop + start` on change; the VS Code extension uses `fs.watch` and calls `client.restart()`. Combined with `npm run watch` (esbuild `--watch` rebuilds `dist/server/server.js` on save), editing TS source automatically restarts the LSP process. Same flag works in both editors; no editor auto-enables it via dev-mode detection. The `make runide-jetbrains` target and the VS Code "Run Extension" launch config both set `OTELCOL_DEV_WATCH=1` already; production installs are unaffected.

Manual restart fallback: **Tools → Restart otelcol Language Server** (also available via _Find Action_).

Full dev-loop reference: [`docs/investigations/jetbrains-dev-loop.md`](investigations/jetbrains-dev-loop.md).

### Sanity check across editors

After installing in any editor, the same smoke applies: open `examples/simple/otelcol-config.yaml` (or copy it to `otelcol-config.otelcol.yaml` if the editor lacks content sniffing; see each per-editor README for the detection caveats), hover on a `receivers:` key, and confirm Markdown component docs come back. A broken pipeline reference should produce a diagnostic.

## Schema source

The schemas under `schemas/` are **vendored** from [otelery/otelcol-schemas](https://github.com/otelery/otelcol-schemas) and committed to this repo. Clone-and-build works with no external checkout. The build step (`scripts/copy-schemas.mjs`) copies them into `./out/schemas/` (for unit tests) and `./dist/schemas/` (for the bundled `.vsix`) so the LSP finds them next to the compiled server.

Refreshing the vendored schemas (when upstream OTel distributions release new versions):

```sh
# from a sibling otelcol-schemas checkout (after running its build):
cp -r ../otelcol-schemas/schemas/distributions/* schemas/distributions/
cp -r ../otelcol-schemas/schemas/json/*           schemas/json/
```

Review the diff, then commit. There is intentionally no auto-fetch; schema updates are reviewed events, not silent build artefacts.

The `otelcol.schemaSource` setting (reserved) will, in a future release, let the extension download schemas from an HTTPS URL or pinned `otelcol-schemas` release tag instead of using the bundled copy. In v0.1.0 the setting has no behaviour.
