# Zed extension — OpenTelemetry Collector

OpenTelemetry Collector support for the Zed editor. Ships the
`OpenTelemetry Collector` language definition, vendored YAML
tree-sitter highlight queries, OTTL injection scaffolding, and a
language-server bridge that delegates all LSP work to the standalone
`otelcol-language-server` binary.

For the best experience, please apply the recommended settings
below.

## Pre-requisites

You need the language server on `PATH` (or pointed at via Zed
settings). Until the server is published to npm, install from a
local checkout:

```sh
# from repo root
npm install
npm run compile
npm pack
npm i -g ./vscode-otelcol-*.tgz
which otelcol-language-server   # should print a path
```

## Recommended Settings

Apply the snippets below in your global Zed `settings.json`
(`cmd-,` / `ctrl-,`) or in a workspace `.zed/settings.json`. Each
section is independent — paste only what you need.

### Filetype detection

By default the extension claims files matched by `path_suffixes` in
`languages/otelcol/config.toml` (`otelcol.yaml`, `otelcol.yml`,
`otelcol-configset.yaml`, `otelcol-config.yaml`, `otelcol-config.yml`)
plus anything whose first line matches `first_line_pattern`
(`# otelcol-configset:` directive, `# otelcol`,
`# opentelemetry-collector`).

Zed currently does not expose a way to glob-match files from
extension code itself, so for the common case where collector
configs are spread across a directory layout it is recommended to
configure detection under `file_types` in Zed's settings:

```jsonc
"file_types": {
  "OpenTelemetry Collector": [
    "**/otelcol/**/*.yaml",
    "**/otelcol/**/*.yml",
    "**/*.otelcol.yaml",
    "**/*.otelcol.yml",
    "**/collector-config.yaml",
    "**/collector-config.yml",
    "**/otel-collector-config.yaml",
    "**/otel-collector-config.yml"
  ]
}
```

Feel free to modify this list as per your needs.

For ambiguous files (a generic `config.yaml` that happens to be a
collector config), add a directive comment as the first line — both
this extension and the VSCode integration treat it as an explicit
opt-in:

```yaml
# otelcol-configset: receivers.yaml processors.yaml exporters.yaml
```

If you'd rather opt into structural detection (the file parses with
a `service.pipelines:` anchor, or has a sibling sidecar/anchor)
without renaming anything, enable the server-side sniffer — see
[Server-side content sniffing](#server-side-content-sniffing-attachtoyaml)
below.

### Highlighting

This extension vendors Zed's stock YAML tree-sitter grammar +
highlight queries (so YAML keys/strings/comments/etc. render
correctly) and overlays LSP semantic tokens to mark component
references, used definitions (bold), and **unused** definitions
(strikethrough italic).

**Required:** Zed ships with semantic tokens **off by default**
(`"semantic_tokens": "off"` in `assets/settings/default.json`).
Without enabling them, the LSP's token stream is ignored, the
extension's bundled
`languages/otelcol/semantic_token_rules.json` has no effect, and
unused components render the same as used ones. Enable per
language:

```jsonc
"languages": {
  "OpenTelemetry Collector": {
    "semantic_tokens": "combined"
  }
}
```

Then `cmd-shift-p` → **`editor: Restart Language Server`**; the
default-settings comment notes the change "may require language
server restart to properly apply." `editor: Toggle Semantic
Highlights` is a useful one-shot to confirm the feature is now
live.

The extension's bundled
`languages/otelcol/semantic_token_rules.json` does the bold-used /
strikethrough-unused styling on any theme without further setup.

To customise the styles (e.g. tune the unused colour to match your
theme), add rules under `global_lsp_settings.semantic_token_rules`
in `settings.json`. Per the [Zed
docs](https://zed.dev/docs/extensions/languages#customizing-semantic-token-styles),
the priority order is **user settings → extension rules → Zed
defaults**, so anything you put here wins over the extension's
bundled rules:

```jsonc
"global_lsp_settings": {
  "semantic_token_rules": [
    {
      "token_type": "class",
      "token_modifiers": ["declaration", "deprecated"],
      "foreground_color": "#7f7f7f",
      "strikethrough": true,
      "font_style": "italic"
    }
  ]
}
```

### Server-side content sniffing (`attachToYaml`)

Zed's extension API has no client-side hook to retag a YAML
document based on its **contents** — which is how the VSCode
integration catches anchor-shaped files (e.g. a generic
`config.yaml` whose body parses to `service.pipelines:`) without
any naming convention. Set `otelcol.attachToYaml: true` and the
language server will run the same sniffer server-side: on every
`didOpen` for a `yaml` document it inspects the head bytes
(directive markers, `service.pipelines` anchor, ≥2 top-level
otelcol keys) and a sibling scan, and only emits
diagnostics / semantic tokens when the file matches. Non-matching
YAML files are dropped silently — your other YAML tooling is left
alone.

```jsonc
"lsp": {
  "otelcol": {
    "settings": {
      "otelcol": {
        "attachToYaml": true
      }
    }
  }
}
```

For this to take effect, Zed must also be willing to ask the
otelcol server about every YAML document. The simplest way is to
extend the `OpenTelemetry Collector` filetype glob to include
`**/*.yaml` via the `file_types` block above — the server then
sniffs each file and filters out the ones that aren't collector
configs.

### Distribution and LSP configuration

The server defaults to `otelcol-contrib`. To target a different
distribution (and load its component catalogue), or to tune
config-set discovery:

```jsonc
"lsp": {
  "otelcol": {
    "settings": {
      "otelcol": {
        "distribution": "otelcol-contrib",
        "contribPath": "",
        "ottlLspPath": "",
        "configSets": {
          "autoDiscover": true,
          "maxFilesScanned": 2000
        }
      }
    }
  }
}
```

A full list of supported keys lives in the repo-root `package.json`
under `contributes.configuration` — every key documented there is
honoured by the server regardless of editor.

### Pointing Zed at a local build

If you're developing the language server out of a checkout, set
`lsp.otelcol.binary` to skip the PATH lookup:

```jsonc
"lsp": {
  "otelcol": {
    "binary": {
      "path": "/abs/path/to/repo/bin/otelcol-language-server.js",
      "arguments": ["--stdio"]
    }
  }
}
```

> **Heads up — Zed bypasses the WASM resolver when `binary.path`
> is set.** Zed spawns the path directly and does not call
> `language_server_command` in the extension, so `arguments` is
> required. Without `["--stdio"]` the server dies with
> `Connection input stream is not set`.

Run `npm run compile` (in the repo root) once so
`dist/server/server.js` exists; re-run on server changes.

## Dev install

1. Open Zed.
2. `Extensions` (`cmd-shift-x` / `ctrl-shift-x`) →
   `Install Dev Extension` → pick the `editors/zed/` directory.
3. Zed builds the Rust crate to WASM and registers the
   `OpenTelemetry Collector` language.

After editing anything under `editors/zed/languages/` (grammar
queries, `config.toml`, `semantic_token_rules.json`), rebuild via
the same Extensions panel — toggle the extension off/on or click
`Rebuild`.

## Verify

Open `examples/simple/otelcol-config.yaml`. If you applied the
filetype detection snippet above, the status bar should read
`OpenTelemetry Collector`. Then:

- Hover on a receiver/processor/exporter key returns Markdown
  component docs.
- Component IDs render in the theme's "type" colour; unused
  components (e.g. an exporter not referenced in any pipeline)
  render strikethrough+italic.
- Breaking a pipeline reference (`receivers: [unknown]`) produces a
  diagnostic on the next save.
- The LSP log (`Zed → Open Log`) shows the `initialize` round-trip.

## Layout

```
editors/zed/
  extension.toml              # grammar pin, language-server binding
  Cargo.toml
  src/otelcol.rs              # Rust → WASM, locates and spawns the LSP
  languages/otelcol/
    config.toml               # language metadata, path_suffixes, brackets
    highlights.scm            # YAML highlight queries (vendored)
    injections.scm            # OTTL injection (no-op until ottl grammar lands)
    semantic_token_rules.json # bold-used / strikethrough-unused styling
```

## Testing

```sh
cd editors/zed
cargo test
# or via the umbrella entry:
make test-zed
```

The suite statically validates `extension.toml`,
`languages/otelcol/config.toml`, the `.scm` query files, and
`semantic_token_rules.json` — no editor binary required. The build
smoke compiles the extension entry to WASM (Zed's runtime target):

```sh
make build-zed
# → editors/zed/target/wasm32-wasip1/debug/*.wasm
```

## Known gaps

- **No client-side content sniffing.** Out of the box, detection
  is via `path_suffixes` + `first_line_pattern` only. For
  structural detection (parses to `service.pipelines:`,
  sibling-anchor scan) enable `otelcol.attachToYaml` so the server
  runs the sniffer on every YAML — see
  [Server-side content sniffing](#server-side-content-sniffing-attachtoyaml).
- **OTTL highlighting** depends on a registered `ottl` grammar.
  Until one ships, the `injections.scm` query is inert. OTTL
  diagnostics still surface if `ottl-lsp` is configured on the
  server side.
- **No npm auto-install yet.** The LSP isn't published to npm as
  `otelcol-language-server`; until it is, Zed cannot
  `npm_install_package` it on first use. Use the
  `lsp.otelcol.binary.path` setting or a global install of
  `vscode-otelcol`.

## Notes

To restart the language server, open the Command Palette and execute
`editor: Restart Language Server`.

## Troubleshooting

**Symptom:** `~/.local/share/zed/logs/Zed.log` shows the LSP
launching with `args: []` and the server crashes with
`Connection input stream is not set`.

**Cause:** `lsp.otelcol.binary.path` is set in `settings.json` but
`arguments` is missing. Zed's settings-driven launch path doesn't
fall back through the extension's WASM resolver (where `--stdio`
would be supplied); it spawns with empty args.

**Fix:** add `"arguments": ["--stdio"]` next to `"path"`. See
[Pointing Zed at a local build](#pointing-zed-at-a-local-build)
above for the full snippet.

When debugging from the log, the launch line for the LSP should
read:

```
starting language server process. binary path: ".../bin/otelcol-language-server.js", ..., args: ["--stdio"]
```

If you see `args: []`, the settings block is missing `arguments`.
If you see `Cannot find module '../dist/server/server.js'`, run
`npm run compile` in the repo root to rebuild the bundle the shim
requires.

**Symptom:** the file opens but is rendered as plain white text
with no highlighting at all.

**Cause:** older versions of this extension referenced Zed's
built-in YAML grammar without declaring it. Zed extensions must
declare every grammar they reference in `extension.toml`.

**Fix:** update to the current extension (which declares
`[grammars.yaml]` pinned to a published `tree-sitter-yaml` commit)
and reinstall the dev extension so Zed re-downloads the grammar.

**Symptom:** unused components render the same as used ones; no
strikethrough on `pprof:` in `test/configsets/ext-unused/base.yaml`,
no bold on `kafka/dr:`. The Zed.log shows the extension reloaded
cleanly with no errors.

**Cause:** Zed's default is `"semantic_tokens": "off"`. The LSP's
token stream is requested only when this is `"combined"` or
`"full"`. With it off, the extension's bundled
`languages/otelcol/semantic_token_rules.json` matches nothing
because no tokens reach the stylizer.

**Fix:** add

```jsonc
"languages": {
  "OpenTelemetry Collector": {
    "semantic_tokens": "combined"
  }
}
```

to `~/.config/zed/settings.json`, then `cmd-shift-p` →
`editor: Restart Language Server`. Confirm via `cmd-shift-p` →
`editor: Toggle Semantic Highlights` (no-op when the feature is
off, toggles when on).
