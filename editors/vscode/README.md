# VS Code — OpenTelemetry Collector

The original target editor. Bundles a TextMate grammar layer for
syntax highlighting and a thin client that spawns the LSP server
(`src/server/`) over IPC. The `bin/otelcol-language-server` stdio
shim used by the other editors is built from the same server
sources.

## Layout

```
editors/vscode/
  src/
    extension.ts                # activation, LSP client, commands
    sniffer.ts                  # retag plain `yaml` docs as `otelcol`
  test/
    integration/                # @vscode/test-cli Extension Host tests
  .vscode-test.mjs              # test runner config (paths repo-relative)
  language-configuration.json   # comments, brackets, indent
  tsconfig.json                 # noEmit typecheck for the extension
  tsconfig.test.json            # compiles test/integration/*.ts → out/test/
  README.md
```

Shared with the rest of the repo (not under `editors/vscode/`):

- `src/server/`, `src/common/` — LSP server + shared YAML classifier.
- `syntaxes/` — TextMate grammars (also consumed by JetBrains).
- `package.json` — single manifest for both the VS Code extension
  and the npm `otelcol-language-server` bin. Splitting into two
  manifests is a future refactor.
- `test/{simple,complex,configsets}/` — fixture workspaces shared
  with the server unit tests.

## Dev install

```sh
# from repo root:
make bundle           # esbuild → dist/extension/extension.js + dist/server/server.js
code --extensionDevelopmentPath="$(pwd)" examples/
```

In the dev host, open any `*.otelcol.yaml` (or a `yaml` file with
a `# otelcol-configset:` directive — the sniffer retags it).

## Testing

```sh
make test-vscode
```

Compiles `editors/vscode/tsconfig.test.json` and runs the
Extension Host against the two workspace fixtures defined in
`.vscode-test.mjs` (`../../test/simple` and `../../test/complex`).

The legacy `make test-integration` alias still works for one
release; prefer the new name.

## Packaging the VSIX

```sh
make package-vscode   # → dist/packages/vscode-otelcol-<version>.vsix
# (`make package` builds every editor's distributable in one go.)
```

`vsce package` runs at the repo root because `package.json` is
there. The root `.vscodeignore` controls which files land in the
archive; sibling editor directories (`editors/{helix,jetbrains,zed,neovim}/`)
and the stdio shim under `bin/` are excluded, so the VSIX only carries:

- `dist/` — bundled extension + server + schemas
- `syntaxes/` — TextMate grammars
- `editors/vscode/language-configuration.json`
- `package.json`, `README.md`, `LICENSE`

## Settings

Same config schema documented at the repo root's `package.json`:
`otelcol.distribution`, `otelcol.contribPath`, `otelcol.ottlLspPath`,
`otelcol.configSets.*`, `otelcol.trace.server`, `otelcol.sniffer.trace`.
