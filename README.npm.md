# opentelemetry-collector-config

Language server for [OpenTelemetry Collector][otelcol] configuration
files (and embedded [OTTL][ottl]). Ships the standalone
`otelcol-language-server` binary used by the Zed, Helix and JetBrains
integrations of [`otelcol-lang`][repo].

> The VS Code extension bundles this same server internally and does
> not require this npm package. Install this package when you use any
> other editor.

[otelcol]: https://github.com/open-telemetry/opentelemetry-collector
[ottl]: https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/pkg/ottl
[repo]: https://github.com/otelery/otelcol-lang

## Install

```sh
npm i -g opentelemetry-collector-config
which otelcol-language-server   # should print a path
```

The package exposes one binary:

```
otelcol-language-server --stdio
```

`vscode-languageserver/node` selects the transport from `process.argv`,
so `--stdio`, `--node-ipc` and `--socket=<port>` all work. Editors
typically invoke it with `--stdio`.

## Features

- Diagnostics for unknown components, malformed pipelines, type
  mismatches against the collector schema.
- Completion + hover for component IDs, signal types, and field names,
  driven by the bundled OpenTelemetry Collector JSON schemas.
- Cross-file definition / references across config-set layouts.
- Embedded OTTL: range-restricted parsing inside `statements`,
  `conditions` and similar OTTL-bearing keys.
- Workspace heuristics for grouping `otelcol-config*.yaml` files into a
  single config set.

## Editor integrations

| Editor    | Install path                                                         |
| --------- | -------------------------------------------------------------------- |
| Zed       | [`otelcol` extension](https://github.com/otelery/otelcol-lang/tree/main/editors/zed) — install this npm package, then enable the extension |
| Helix     | [`languages.toml` snippet](https://github.com/otelery/otelcol-lang/tree/main/editors/helix) |
| JetBrains | [LSP4IJ-based plugin](https://github.com/otelery/otelcol-lang/tree/main/editors/jetbrains) |
| VS Code   | Use the [VS Code Marketplace extension](https://marketplace.visualstudio.com/items?itemName=otelery.opentelemetry-collector-config) — it bundles the server. |

## Configuration

The server reads workspace-level options sent by the editor through
`workspace/configuration`. Two are worth knowing about:

- `otelcol.contribPath` — optional absolute path to a local
  `opentelemetry-collector-contrib` checkout. When set, the server
  reads component schemas from that tree instead of the bundled
  snapshot. Useful when you track contrib HEAD.
- `otelcol.autoConfigSet` — when `true` (default), the server groups
  collector files in a directory into a single logical config set so
  cross-file references resolve.

See your editor's integration docs for the exact JSON layout (Zed,
Helix and JetBrains each have their own).

## Smoke test

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}}' \
  | otelcol-language-server --stdio
```

Should emit a `capabilities` response without crashing.

## License

Apache-2.0. See [LICENSE][license] in the repo.

[license]: https://github.com/otelery/otelcol-lang/blob/main/LICENSE
