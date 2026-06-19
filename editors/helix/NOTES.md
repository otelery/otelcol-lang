# Helix — otelcol language support

## Minimum-viable config

Edit `~/.config/helix/languages.toml` (or `.helix/languages.toml` per-project):

```toml
[language-server.otelcol]
command = "otelcol-language-server"
args = ["--stdio"]
config = { otelcol = { distribution = "otelcol-contrib", configSets = { autoDiscover = true, maxFilesScanned = 2000 } } }

[[language]]
name = "otelcol"
scope = "source.otelcol"
injection-regex = "otelcol"
file-types = [
  { glob = "*.otelcol.yaml" },
  { glob = "*.otelcol.yml" },
  { glob = "configset.otelcol.yaml" },
]
shebangs = []  # YAML doesn't really shebang, but `# configset-otelcol:` works similarly
roots = ["configset.otelcol.yaml", ".git"]
comment-token = "#"
indent = { tab-width = 2, unit = "  " }
language-servers = ["otelcol"]
grammar = "otelcol_yaml"

[[grammar]]
name = "otelcol_yaml"
source = { git = "https://github.com/…/tree-sitter-otelcol-yaml", rev = "TBD" }
```

After editing: `hx --grammar fetch && hx --grammar build`.

Prereq: `npm i -g otelcol-language-server` (see
[SHARED.md §4](../SHARED.md#4-distribution-recommendation)).

## Filetype detection

Helix uses `file-types` globs and `shebangs`. No content-based sniffing
hook is exposed. This means:

- `foo.otelcol.yaml` → detected.
- `configset.otelcol.yaml` (the sidecar) → detected by exact-name glob.
- A plain `foo.yaml` with a `# configset-otelcol:` directive → **not**
  detected. User must either rename the file, add a `language-id` mode
  line (`# helix: language=otelcol` — verify Helix actually supports
  this), or invoke `:set-language otelcol` after opening.

This is a real downgrade from the VS Code experience. Document the
filename convention prominently or accept the manual `:set-language` step.

See [SHARED.md §5](../SHARED.md#5-per-editor-is-this-an-otelcol-file-detection)
for the per-editor detection comparison.

## Tree-sitter

Helix uses tree-sitter natively. The `[[grammar]]` block above pulls a
parser from a Git repo and builds it locally. Highlights/injections live
in `runtime/queries/otelcol_yaml/highlights.scm` (and `injections.scm`
for OTTL-inside-YAML). The grammar artifacts are shared with Zed and Neovim —
[see Zed's tree-sitter notes](../zed/NOTES.md#tree-sitter-injection-for-ottl-inside-yaml).

## Packaging story

Helix has no extension marketplace. Distribution is:

1. **LSP server:** `npm i -g otelcol-language-server`.
2. **Tree-sitter grammar:** documented `[[grammar]]` block, fetched/built
   via `hx --grammar fetch && hx --grammar build`.
3. **Queries:** users must drop `highlights.scm` / `injections.scm` into
   their `~/.config/helix/runtime/queries/otelcol_yaml/` directory.
   Document this clearly — it's the biggest UX rough edge.

Long-term, Helix accepts grammar contributions into its own repo
(`helix-editor/helix`'s `languages.toml` + bundled queries), at which
point installation collapses to "install the LSP server, the rest is
already there". That's an upstream PR conversation, not a worktree
deliverable.

## Open questions

- **Mode-line language override:** does Helix honour a magic comment like
  `# helix: language=otelcol` for files outside the configured globs?
  Couldn't find documentation; read source or test.
- **`workspace/configuration`:** Helix supports passing `config` in
  `languages.toml`, but the server reads via `workspace/getConfiguration`
  on demand. Verify Helix responds to the request rather than only sending
  config at `initialize`.
- **File watching:** Helix's LSP layer support for
  `workspace/didChangeWatchedFiles` is partial as of 2024 — the server's
  cross-file diagnostics will silently miss out-of-band edits unless we
  fall back to mtime polling (which we currently don't). Risk: open
  `pipelines.yaml`, edit `receivers.yaml` in another tool, no
  re-validation.
- **Diagnostics for non-open files:** Helix only displays diagnostics for
  open buffers in its UI. The server publishes to all member URIs of a
  configset — those diagnostics will silently disappear in Helix unless
  the member is open. Consider a `workspace/diagnostic` (pull-mode)
  capability if/when Helix grows it.
