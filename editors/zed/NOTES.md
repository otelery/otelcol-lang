# Zed — otelcol language support

## Minimum-viable extension scaffold

Zed extensions live in their own repo (or `extensions/` subdir of a monorepo)
and are loaded via `Extensions → Install Dev Extension`. The skeleton:

```
zed-otelcol/
  extension.toml
  languages/
    otelcol/
      config.toml
      highlights.scm          # tree-sitter queries
      injections.scm          # OTTL-inside-YAML injection
  src/
    otelcol.rs                # Rust extension entry (or WASM-compatible Rust)
  Cargo.toml
```

### `extension.toml`

```toml
id = "otelcol"
name = "OpenTelemetry Collector"
version = "0.1.0"
schema_version = 1
authors = ["…"]
description = "Syntax + LSP for OpenTelemetry Collector configs and OTTL"
repository = "https://github.com/…"

[language_servers.otelcol]
name = "OpenTelemetry Collector"
languages = ["OpenTelemetry Collector"]

[grammars.otelcol_yaml]
repository = "https://github.com/…/tree-sitter-otelcol-yaml"
commit = "TBD"

[grammars.ottl]
repository = "https://github.com/…/tree-sitter-ottl"
commit = "TBD"
```

### `languages/otelcol/config.toml`

```toml
name = "OpenTelemetry Collector"
grammar = "otelcol_yaml"
path_suffixes = ["otelcol.yaml", "otelcol.yml"]
first_line_pattern = "^#\\s*(otelcol|opentelemetry-collector|otelcol-configset:)\\b"
line_comments = ["# "]
autoclose_before = ":,]}"
brackets = [
  { start = "{", end = "}", close = true, newline = true },
  { start = "[", end = "]", close = true, newline = true },
  { start = "\"", end = "\"", close = true, newline = false, not_in = ["string"] },
]
```

Detection caveats — see [SHARED.md §5](../SHARED.md#5-per-editor-is-this-an-otelcol-file-detection).
Zed has no equivalent to the extension's runtime classifier, so we lose content-based
retagging. The escape hatch is the `# otelcol-configset:` directive or naming files
`*.otelcol.yaml`.

### Rust extension entry (`src/otelcol.rs`)

Zed's extension API requires a `LanguageServer` impl that returns the binary
to spawn. The cleanest path is to require the user to install
`otelcol-language-server` via `npm i -g` and look it up on PATH:

```rust
use zed_extension_api::{self as zed, Result};

struct OtelcolExtension;

impl zed::Extension for OtelcolExtension {
    fn new() -> Self { Self }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let path = worktree
            .which("otelcol-language-server")
            .ok_or_else(|| "otelcol-language-server not found on PATH. Install via `npm i -g otelcol-language-server`.".to_string())?;
        Ok(zed::Command {
            command: path,
            args: vec!["--stdio".into()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(OtelcolExtension);
```

(A future iteration could download a versioned binary into the extension's
work dir, à la the Rust/Go extensions — but that requires us to publish
per-OS artifacts first. See [SHARED.md §4](../SHARED.md#4-distribution-recommendation).)

### Tree-sitter injection for OTTL-inside-YAML

This is the *single biggest unknown* for Zed. OTTL appears inside YAML
string values under specific keys (e.g. `statements:` under transform
processor). TextMate handles this via embedded patterns scoped to those
keys. Tree-sitter handles it via `injections.scm`:

```scheme
; Inject OTTL into string values that are children of an `statements` key.
; Sketch only — the actual node names depend on tree-sitter-yaml's grammar.
(block_mapping_pair
  key: (flow_node) @_key
  value: (block_node
           (block_scalar) @injection.content))
  (#eq? @_key "statements")
  (#set! injection.language "ottl"))
```

Open question — do we author our own `tree-sitter-otelcol-yaml` that
extends/forks `tree-sitter-yaml`, or do we rely on stock `tree-sitter-yaml`
with `injections.scm` doing the routing? Forking is more invasive but lets
us tighten validation; injection-only is faster to prototype.

## Packaging story

Two stages:

1. **Dev install:** clone this worktree's `editors/zed/` directory into a
   standalone scaffold, point Zed at it via Install Dev Extension. Iterate
   on grammar + LSP.
2. **Publish:** submit to [`zed-industries/extensions`](https://github.com/zed-industries/extensions)
   monorepo as a Git submodule. Zed auto-builds Rust extensions to WASM
   server-side. Tree-sitter grammars are pulled from the URL/commit pinned
   in `extension.toml`.

LSP binary distribution is decoupled from the extension itself —
`otelcol-language-server` must already be on the user's PATH (npm global
install). Document this as a prereq in the extension README.

## Open questions

- **Injection grammar:** are tree-sitter-yaml's block-scalar nodes addressable
  cleanly from an external injection query, or do we need our own grammar?
  No way to know without a tree-sitter playground session.
- **Workspace-aware schema selection:** the `otelcol.distribution` setting
  toggles which schema bundle the server loads. Zed passes settings via
  `workspace/configuration`; verify the request reaches the server and the
  reload path (`onDidChangeConfiguration` in `src/server/server.ts:116`)
  re-validates open docs.
- **`firstLine` detection equivalent:** Zed's `first_line_pattern` is regex,
  but is it run on every YAML file, or only on files matched by
  `path_suffixes`? If the latter, we can't retag a plain `foo.yaml` that
  happens to have a `# otelcol-configset:` directive. Read source or test
  empirically.
- **Multi-file configset semantics:** the extension's sniffer retags
  fragment files (e.g. `receivers.yaml`) when an anchor or sidecar is
  present in the same directory. Zed has no hook for that. Either rely on
  `# otelcol-configset:` directive on every fragment, or accept that
  fragments outside the anchor file get treated as plain YAML.
