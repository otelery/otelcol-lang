# Config-set with a sidecar declaration

Multi-file config where membership and merge order are declared
explicitly in `configset.otelcol.yaml`:

```yaml
# configset.otelcol.yaml
members:
  - base.yaml
  - exporters.yaml
  - pipelines.yaml
```

Use this pattern when you want a fully explicit member list — handy
when the same directory contains other YAML files that aren't part of
the collector config (templates, ansible vars, helm values, etc.).

## Run

```sh
otelcol-contrib \
  --config=examples/configset-sidecar/base.yaml \
  --config=examples/configset-sidecar/exporters.yaml \
  --config=examples/configset-sidecar/pipelines.yaml
```

## How the extension finds it

Opening any member file, the extension walks up to find
`configset.otelcol.yaml` and treats every listed `members[*]` path
(relative to the sidecar) as part of the same config-set. The anchor
file (the one with `service.pipelines:`) must appear in the list.

Compare with [`../configset-directive/`](../configset-directive/) for
the inline-directive flavour of the same pattern.
