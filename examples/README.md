# Examples

Curated OpenTelemetry Collector configurations to try the extension
against. Open any of them in VS Code with `otelcol-lang` installed
and exercise hover, completion, go-to-definition, find-references
and diagnostics.

These files are documentation, not test fixtures (those live under
[`test/`](../test/)) — they aim to be realistic configurations you'd
plausibly run, not minimal regression-pinning shapes.

## Index

| Example                                          | What it shows                                                                                                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`simple/`](./simple/)                           | Single-file config with OTLP receivers, batch/memory-limiter, OTLP/debug exporters, health-check extension. The smallest "real" collector config.                                                                       |
| [`complex/`](./complex/)                         | Production-shaped multi-file: many receivers, OTTL inside `transform` + `filter`, the `routing` connector, `spanmetrics` deriving R.E.D metrics, multiple exporters. Exercises every LSP feature.                       |
| [`configset-sidecar/`](./configset-sidecar/)     | Multi-file config-set declared by an `otelcol-configset.yaml` sidecar. Use when you want explicit control over the member list and merge order.                                                                         |
| [`configset-directive/`](./configset-directive/) | Multi-file config-set declared by a first-line `# otelcol-configset:` directive in the anchor file. Use when you want a single self-contained declaration.                                                              |
| [`diagnostics/`](./diagnostics/)                 | Deliberately broken single-file config (`diagnostics/broken.yaml`). Demonstrates the extension's diagnostics: undefined reference, unknown component type, invalid pipeline signal. Open it and read the Problems panel. |

## Running a config locally

The simple example runs against the upstream `otelcol-contrib`
distribution:

```sh
otelcol-contrib --config=examples/simple/otelcol-config.yaml
```

Multi-file examples use the collector's repeatable `--config` flag:

```sh
otelcol-contrib \
  --config=examples/complex/base.yaml \
  --config=examples/complex/processors.yaml \
  --config=examples/complex/exporters.yaml \
  --config=examples/complex/pipelines.yaml
```

The extension picks the same files up automatically as a
**config-set** (LSP cross-file references work without `--config`
flags); see the README at the repo root for how discovery works.

## Pinning a distribution

To validate against a specific Collector distribution + version, add a
`# yaml-language-server:` pragma at the top of the anchor file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/otelery/otelcol-schemas/main/schemas/json/otelcol-contrib-config-0.152.0.json
receivers:
  otlp:
```

Available schemas: see the
[otelcol-schemas catalog](https://github.com/otelery/otelcol-schemas/blob/main/schemas/json/catalog.json).
