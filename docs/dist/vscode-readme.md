# OpenTelemetry Collector Config

Editor support for [OpenTelemetry Collector][otelcol] configuration
files inside VS Code: syntax highlighting, completion, hover docs,
diagnostics, cross-file references, and embedded
[OTTL][ottl] support — powered by a bundled language server.

[otelcol]: https://github.com/open-telemetry/opentelemetry-collector
[ottl]: https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/pkg/ottl

## Features

- **Diagnostics** — unknown components, malformed pipelines, type
  mismatches checked against the collector JSON schemas.
- **Completion + hover** — component IDs, signal types, field names,
  with descriptions sourced from the collector schemas.
- **Cross-file references** — go-to-definition and find-references
  across multi-file config-set layouts.
- **Embedded OTTL** — range-restricted parsing inside `statements`,
  `conditions` and similar OTTL-bearing keys.
- **Workspace heuristics** — automatic grouping of
  `otelcol-config*.yaml` files into a single logical config set.

## Activation

The extension claims:

- Files matching `otelcol*.yaml` / `otelcol*.yml` / `otelcol-configset.yaml`.
- Any YAML file whose first line is `# otelcol-configset:`, `# otelcol`,
  or `# opentelemetry-collector`.

For other naming schemes, set the file's language manually via
`Change Language Mode → OpenTelemetry Collector`.

## Settings

| Setting | Purpose |
| --- | --- |
| `otelcol.distribution` | Which collector distribution to validate against (defaults to `otelcol-contrib`). |
| `otelcol.contribPath` | Optional local `opentelemetry-collector-contrib` checkout — used to surface component READMEs on hover. |
| `otelcol.ottlLspPath` | Path to `ottl-lsp` for embedded OTTL diagnostics. |
| `otelcol.autoConfigSet` | Auto-group config fragments by `service.pipelines:` anchors (default on). |
| `otelcol.trace.server` | Trace LSP traffic for debugging. |
| `otelcol.sniffer.trace` | Log per-file retag decisions to the `Otelcol Sniffer` output channel. |

See the full list in *Settings → Extensions → OpenTelemetry Collector
Config*.

## Other editors

The same language server backs Zed, Helix and JetBrains via the
[`opentelemetry-collector-config`](https://www.npmjs.com/package/opentelemetry-collector-config)
npm package. See the per-editor docs in the
[GitHub repository](https://github.com/otelery/otelcol-lang).

## License

Apache-2.0.
