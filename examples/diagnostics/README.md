# Diagnostics demo

`broken.yaml` is a deliberately invalid OpenTelemetry Collector
configuration. Open it in VS Code with `otelcol-lang` installed and
the Problems panel lights up with the LSP's diagnostics:

| Problem in the file              | What the LSP says                              |
| -------------------------------- | ---------------------------------------------- |
| `bogus_exporter_type:`           | unknown component type for the active distro   |
| `exporters: [does_not_exist]`    | undefined reference (no matching exporter id)  |
| `nonsense_signal:` pipeline name | invalid pipeline signal (not traces/metrics/…) |

Use this as the canonical "is the LSP wired up?" smoke test. If you
open `broken.yaml` and see red squiggles in those three spots, the
extension is fully active and talking to the language server.
