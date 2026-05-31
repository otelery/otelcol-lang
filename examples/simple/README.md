# Simple single-file config

OTLP receivers (gRPC + HTTP) → memory-limiter → batch → OTLP exporter
to a remote backend, with a `debug` exporter for local visibility and
a `health_check` extension for k8s probes. Three pipelines: traces,
metrics, logs.

The smallest config that exercises every top-level section
(`receivers` / `processors` / `exporters` / `extensions` / `service`).

## Run

```sh
otelcol-contrib --config=examples/simple/otelcol-config.yaml
```

## Things to try in the editor

- Hover any component ID (`otlp`, `batch`, `health_check`, …) to see
  display name + signals + stability.
- Position the cursor inside any pipeline ref (e.g. `[otlp]` in
  `traces.receivers`) and press F12 — jumps to the definition.
- Rename `otlp` in `exporters` to something undefined — see the
  red-squiggle diagnostic land in `service.pipelines.*.exporters`.
