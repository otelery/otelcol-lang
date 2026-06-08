# Cross-editor concerns

Research notes for porting the OpenTelemetry Collector language tooling
beyond VS Code. Lives on branch `editor-integrations` (off `better-sniffing`)
in worktree `../otelcol-lang-idea`. Nothing here ships back to `main` or
`better-sniffing` without explicit sign-off.

## 1. stdio launch

**Status:** server is portable as-is; client wiring needs a thin entry point.

The LSP server (`src/server/server.ts`) imports only from
`vscode-languageserver/node` and `vscode-languageserver-textdocument` — both
are protocol libraries, not the VS Code editor API. A repo-wide grep for
`vscode` in `src/server/` returns:

- `vscode-languageserver*` imports (standard LSP libs, cross-editor)
- `.vscode` as a directory name in `SKIP_DIRS` (purely a string)
- One doc comment referring to `vscode-uri` URI encoding

Today the server is launched as a Node module over IPC by the extension
(`src/extension/extension.ts:93`, `TransportKind.ipc`). For stdio:

- `createConnection(ProposedFeatures.all)` at `src/server/server.ts:45`
  auto-detects transport from `process.argv` — `--stdio`, `--node-ipc`,
  or `--socket=PORT`. This is built-in behaviour of `vscode-languageserver/node`.
  **High-confidence claim, unverified in this repo:** `node dist/server/server.js --stdio`
  Just Works without code changes. Verify by running it and piping a hand-rolled
  `initialize` request.
- The cleanest distribution surface is a `bin` entry in `package.json` (e.g.
  `otelcol-language-server`) whose script is a one-line shebanged wrapper:
  `#!/usr/bin/env node` + `require("../dist/server/server.js")`. Then editors
  invoke `otelcol-language-server --stdio`.

## 2. Schema location

**Status:** already CWD-independent. No `--schemas` flag needed.

`src/server/components.ts:91-94` resolves schemas relative to `__dirname`:

```
dist/server/server.js  →  ../schemas/<sub>   (i.e. dist/schemas/<sub>)
```

`__dirname` is the _bundled file's_ directory at runtime, independent of the
client's CWD. As long as `dist/schemas/` ships alongside `dist/server/server.js`
(which `copy-schemas.mjs` ensures), the server finds its schemas no matter who
launched it or from where.

Implication for packaging: the published npm tarball must include both
`dist/server/` and `dist/schemas/`. The existing `.vscodeignore` is
VS-Code-specific; an `.npmignore` (or `files:` in `package.json`) will need
explicit coverage when we go to publish.

## 3. Grammar source-of-truth

**Decision:** tree-sitter is canonical for `otelcol-yaml` and `ottl` going
forward. TextMate grammars (`syntaxes/otelcol-yaml.tmLanguage.json`,
`syntaxes/ottl.tmLanguage.json`) are kept in parallel **only for VS Code and
JetBrains** (both have first-class TextMate support and no native tree-sitter
embedding).

Maintenance contract:

- Editing the tree-sitter grammar is the authoritative change. Whoever
  touches a token class or scope is expected to mirror non-trivial changes
  into the TextMate grammars in the same PR.
- TextMate may legitimately lag on features that have no scope-equivalent
  (e.g. tree-sitter injections for OTTL-inside-YAML — TextMate handles this
  via embedded patterns, but the boundaries differ).
- Test fixtures (`examples/*.yaml`) should round-trip through both grammar
  paths in CI before the dual-maintenance contract is durable. Today they
  don't — flag for the actual port.

## 4. Distribution recommendation

Prior art across four widely-consumed Node-based LSP servers:

| Server                         | Install                                          | CLI binary                                      | Invocation      |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------- | --------------- |
| `yaml-language-server`         | `npm i -g yaml-language-server`                  | (runs via `node out/.../server.js`)             | `--stdio`       |
| `typescript-language-server`   | `npm i -g typescript-language-server typescript` | `typescript-language-server`                    | `--stdio`       |
| `bash-language-server`         | `npm i -g bash-language-server` (also dnf, snap) | `bash-language-server`                          | `start`         |
| `vscode-langservers-extracted` | `npm i -g vscode-langservers-extracted`          | `vscode-{html,css,json,eslint}-language-server` | (stdio default) |

The dominant pattern is unambiguous: **publish an npm package with a `bin`
entry that exposes a single CLI binary accepting `--stdio`**. Editors then
wire it via their generic LSP client.

Recommendation for otelcol-lang:

1. Publish `otelcol-language-server` (or `otelcol-lsp` — bikeshed later) to
   npm. The package wraps the existing `dist/` tree and exposes one bin.
2. Stick with `--stdio` invocation. Skip subcommand-style entry points
   (`bash-language-server start`) — they're a wart from that project's
   history, not a pattern to copy.
3. Don't ship pre-built native binaries (`pkg`, `nexe`, single-file). The
   maintenance + per-OS-release tax isn't justified given that every target
   editor's user base already has Node available (Zed-extension authors do;
   Neovim users overwhelmingly do; Helix users mostly do; JetBrains plugin
   authors definitely do).
4. Version the npm package together with the VS Code extension's `package.json`
   (single source of truth). Surface the server version in `initialize`'s
   `serverInfo.version` for clients that want to check compatibility.

## 5. Per-editor "is this an otelcol file?" detection

VS Code uses the sniffer at `src/extension/sniffer.ts` (which now delegates
to the shared classifier at `src/common/yaml-classify.ts`) to retag generic
`yaml` documents as `otelcol`. Detection signals, in priority order:

1. `# otelcol-configset: …` first-line directive
   (regex: `^#\s*otelcol-configset:\s*(.+)$`)
2. Top-level `service:` with `pipelines:` nested under it
3. Sidecar file `otelcol-configset.yaml` in the same directory
4. Filename heuristics (`*.otelcol.yaml`, `otelcol-*.yaml`, etc.)
5. First-line marker comment (`^#\s*(otelcol|opentelemetry-collector)\b`)

Per-editor equivalents:

| Editor    | Mechanism                                                                                                     | Maps cleanly?                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Zed       | `languages/<lang>/config.toml`: `path_suffixes` + `first_line_pattern`                                        | partial — no equivalent to runtime classification; rely on (4) + (5) only |
| Neovim    | `vim.filetype.add({ pattern = …, extension = …, filename = … })`; can also use Lua function for content sniff | full — can replicate the classifier exactly via a Lua callback            |
| Helix     | `languages.toml`: `file-types` and `shebangs`                                                                 | partial — no content sniff; rely on (4) + (5)                             |
| JetBrains | Per-file-type pattern via `FileTypeRegistry`; full content sniff via custom `FileType` if needed              | full — but requires Java/Kotlin plugin code                               |

**Open question:** for Zed/Helix, do we accept the loss of content-based
classification (forcing users to either name files `*.otelcol.yaml` or add
a marker comment), or do we ship the classifier as a server-side capability
(e.g. a `workspace/didOpen` filter that's a no-op when the file is genuinely
not otelcol)? The latter would require editors to associate `*.yaml` with
the otelcol server unconditionally, which is hostile to users with mixed YAML.

Likely answer: lean on the filename + marker-comment paths for those editors,
and document the convention. Promote the `# otelcol-configset:` directive
as the universal escape hatch.

## 6. Open questions worth carrying forward

- Workspace folders / single-file mode: server already handles workspace-less
  files via `ensureRootFor` in `src/server/server.ts:176`. Helix and Zed both
  pass a workspace; nvim depends on plugin config. Probably fine — verify per
  editor.
- File watching: the extension creates `workspace.createFileSystemWatcher(...)`
  and the server consumes `onDidChangeWatchedFiles`. Non-VS-Code clients vary
  in whether they synthesise these events. Server has `readDisk` + diskCache
  as a fallback but invalidation is event-driven, so stale reads are possible
  for files modified out-of-band. Document per-editor.
- Configuration: server calls `connection.workspace.getConfiguration("otelcol")`.
  Clients that don't implement `workspace/configuration` fall back to defaults
  (already defensive in `src/server/server.ts:96-100`). The `distribution`
  setting (which controls which schema set loads) needs an equivalent in each
  editor's config story.
- Embedded OTTL: forwarded to a separate `ottl-lsp` binary via
  `src/server/ottl-forward.ts`. Same distribution question applies — either
  bundle as a peer npm package, or document the manual install.
