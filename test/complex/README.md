# Complex multi-file collector config

Mirrors a production-ish topology: many receivers, lots of OTTL inside
`transform` + `filter`, the `routing` connector splitting traces by
tenant, `spanmetrics` deriving R.E.D metrics, multiple exporters.

The files are intended to be loaded together with the collector's
multi-`--config` flag. The order matters because of confmap deep-merge
semantics (later sources win on scalars and sequences, maps merge):

```sh
otelcol-contrib \
  --config=test/complex/base.yaml \
  --config=test/complex/processors.yaml \
  --config=test/complex/exporters.yaml \
  --config=test/complex/pipelines.yaml
```

The extension picks the same files up via the
`otelcol.splitConfig` setting when `base.yaml` is the active editor.

## Layout

| file              | adds                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `base.yaml`       | receivers (otlp, kafka, hostmetrics, filelog, prometheus); ext'ns. |
| `processors.yaml` | memory_limiter, batch, transform (OTTL), filter (OTTL), attributes |
| `exporters.yaml`  | otlp, otlphttp, kafka, prometheus, debug                           |
| `pipelines.yaml`  | service.pipelines and the routing/spanmetrics/forward connectors   |

## Things to look for

- Coloured OTTL inside every `statements:` / `conditions:` / `condition:`
  block (transform processor, filter processor, routing connector).
- Hover any component ID — receiver, processor, exporter, connector —
  to see its display name, signals, distribution, README blurb.
- Hover an ID in `service.pipelines.<sig>.<bucket>` to verify it
  resolves to the matching definition; F12 jumps there.
- Break it intentionally: rename `transform` → `transformx` and
  watch the pipeline ref flag the dangling reference.
