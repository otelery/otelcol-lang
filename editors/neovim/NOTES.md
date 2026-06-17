# Neovim — otelcol language support

## Minimum-viable config

Targets Neovim 0.11+ (uses `vim.lsp.config` / `vim.lsp.enable`).
Older nvim or non-nvim Vim needs `nvim-lspconfig` + adapter; not covered here.

### LSP wiring

```lua
vim.lsp.config.otelcol = {
  cmd = { 'otelcol-language-server', '--stdio' },
  filetypes = { 'otelcol' },
  root_markers = { 'configset.otelcol.yaml', '.git' },
  settings = {
    otelcol = {
      distribution = 'otelcol-contrib',
      configSets = { autoDiscover = true, maxFilesScanned = 2000 },
    },
  },
}
vim.lsp.enable 'otelcol'
```

Prereq: `npm i -g otelcol-language-server` — see
[SHARED.md §4](../SHARED.md#4-distribution-recommendation).

### Filetype detection

Neovim is the editor where we can replicate the extension's classifier most
faithfully, because `vim.filetype.add` accepts Lua functions:

```lua
vim.filetype.add {
  extension = {
    -- *.otelcol.yaml, *.otelcol.yml
    yaml = function(path, bufnr)
      if path:match('%.otelcol%.ya?ml$') then return 'otelcol' end
      local first = vim.api.nvim_buf_get_lines(bufnr, 0, 1, false)[1] or ''
      if first:match('^#%s*configset%-otelcol:') then return 'otelcol' end
      if first:match('^#%s*otelcol') or first:match('^#%s*opentelemetry%-collector') then
        return 'otelcol'
      end
      -- Full classifier (parse top of buffer for service.pipelines etc.) is
      -- worth porting later if needed; the directive + filename heuristics
      -- cover the documented escape hatches.
      return nil
    end,
  },
  filename = {
    ['configset.otelcol.yaml'] = 'otelcol',
  },
}
```

The extension's content-based retag (`src/extension/sniffer.ts` →
`src/common/yaml-classify.ts`) is more thorough — it parses up to 16KB of
the document with `parseDocument` and inspects top-level keys. Porting that
to Lua means either rewriting in Lua (cheap; the rules are a handful of
regex + key presence checks) or calling out to the LSP server for
classification (over-engineered for filetype detection). Defer until users
ask.

### Tree-sitter

```lua
require('nvim-treesitter.configs').setup {
  ensure_installed = { 'yaml', 'otelcol_yaml', 'ottl' },
  highlight = { enable = true },
}
```

The custom parsers need to be registered with `nvim-treesitter` via its
parser config (or installed manually under `~/.local/share/nvim/treesitter/parser/`).
Until we publish the grammars to a Git repo, this is a manual step.

Injection of OTTL into YAML strings is handled by `injections.scm` shipped
with the parser — same grammar artifacts as Zed
([see Zed notes](../zed/NOTES.md#tree-sitter-injection-for-ottl-inside-yaml)).

## Packaging story

Three artifacts, distributed independently:

1. **LSP server:** `npm i -g otelcol-language-server` (shared with all
   editors).
2. **Tree-sitter grammars:** publish `tree-sitter-otelcol-yaml` and
   `tree-sitter-ottl` as Git repos; register via nvim-treesitter parser
   config or `:TSInstall`.
3. **Lua config snippet:** the LSP wiring + filetype detection above.
   Either users copy-paste it from docs, or we ship a small Lua plugin
   (`otelcol.nvim`) that wraps the setup.

The plugin route is conventional and discoverable (lazy.nvim / packer
users expect it). Worth doing once the server is stable enough to commit
to a public API.

## Open questions

- **Single-file mode:** when there's no `root_markers` match, does nvim
  start the server with an empty `workspaceFolders` list? The server's
  `ensureRootFor` fallback (`src/server/server.ts:176`) should handle that,
  but worth testing — especially for `:edit /tmp/scratch.yaml`-style flows.
- **File watching:** nvim 0.10+ does have `workspace/didChangeWatchedFiles`
  support via the LSP layer, but it depends on `dynamicRegistration` from
  the server. Verify the server registers a watcher and that nvim honours it.
- **OTTL forwarder:** the server spawns `ottl-lsp` if configured. On nvim,
  the path is set via the `otelcol.ottlLspPath` setting — confirm
  `workspace/configuration` round-trips correctly.
- **Diagnostics on unopened members:** the extension publishes diagnostics
  to URIs that aren't currently open buffers (so cross-file errors show up
  in a flat diagnostic list). Nvim's `vim.diagnostic` does accept
  diagnostics for non-loaded buffers, but UI surfaces (Trouble, etc.) vary.
  Test with at least Trouble + the built-in `:lua vim.diagnostic.setqflist()`.
