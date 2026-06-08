# Helix — OpenTelemetry Collector

Drop-in config + queries for editing otelcol configs in Helix.

## Install

1. **LSP server** — install once globally:

   ```sh
   # from the repo root:
   npm run compile
   npm pack
   npm i -g ./vscode-otelcol-*.tgz
   # verify:
   which otelcol-language-server
   ```

2. **Helix language config** — merge `languages.toml` into your
   user config (creates the file if it doesn't exist):

   ```sh
   cat editors/helix/languages.toml >> ~/.config/helix/languages.toml
   ```

3. **Tree-sitter queries** — symlink so query updates flow through:

   ```sh
   mkdir -p ~/.config/helix/runtime/queries
   ln -s "$(pwd)/editors/helix/runtime/queries/otelcol" \
         ~/.config/helix/runtime/queries/otelcol
   ```

   Helix's bundled `yaml` grammar provides the parser — no
   `hx --grammar fetch` step is needed.

## Verify

```sh
hx examples/simple/otelcol-config.yaml
```

The file doesn't match the otelcol globs, so run `:set-language
otelcol` once inside Helix. Then:

- `:lsp-workspace-command` should list the otelcol server attached.
- Hover (`K`) on a `receivers:` key returns Markdown component docs.
- Completion (`<C-x>`) inside an empty pipeline lists known
  component IDs.

For a glob-matched test, copy the file to
`examples/simple/otelcol-config.otelcol.yaml` — the language picks
up automatically.

## Detection caveats

Helix has no content-based filetype sniffing hook. Files are
detected only via `file-types` globs:

- `*.otelcol.yaml`
- `*.otelcol.yml`
- `otelcol-configset.yaml`

A plain `foo.yaml` with a `# otelcol-configset:` directive will
**not** auto-detect. Workarounds:

- Rename the file to match a glob.
- Run `:set-language otelcol` after opening.

## Testing

The Helix integration ships its own test suite — static validation
of the TOML config and the `.scm` query files. Pure Node, no extra
deps:

```sh
node --test editors/helix/test/*.test.mjs
# or via the umbrella entry:
make test-helix
```

Opt-in integration tests (parse YAML fixtures via tree-sitter, run
`hx --health otelcol` if `hx` is on PATH):

```sh
make test-helix-integration
```

## OTTL highlighting

The bundled injection query routes OTTL string bodies (under
`statements:` / `conditions:` keys) to an `ottl` language. Helix
does not ship an `ottl` grammar, so this injection is currently a
no-op for highlighting. OTTL **diagnostics** still flow if you
configure `otelcol.ottlLspPath` to point at an `ottl-lsp` binary —
see the server's `OttlForwarder` for the protocol.
