# Config-set with a shared base across environments

A shared `base/` config reused by two environments, `prod/` and
`staging/`. Each environment owns a sidecar that pulls the shared
fragments in with **parent-relative** `../base/...` paths (resolved
against the sidecar's directory) and adds its own environment-local
files:

```
configset-shared-base/
  base/                    # shared, environment-agnostic fragments
    receivers.yaml         #   otlp receiver
    exporters.yaml         #   otlp/backend exporter
  prod/
    configset.otelcol.yaml #   members: ../base/* + pipelines.yaml
    pipelines.yaml         #   anchor — lean prod path
  staging/
    configset.otelcol.yaml #   members: ../base/* + exporters.yaml + pipelines.yaml
    exporters.yaml         #   staging-only debug exporter
    pipelines.yaml         #   anchor — base path + extra traces/debug pipeline
```

This is two independent config-sets — `prod/pipelines.yaml` and
`staging/pipelines.yaml` are each an anchor (a file with
`service.pipelines:`), and each finds the sidecar in its **own**
directory. The shared `base/*.yaml` fragments are members of *both*.

## prod vs. staging

- **prod** is the lean path: OTLP in → `otlp/backend` out.
- **staging** reuses the exact same base, then layers on a
  staging-only `debug` exporter and an extra `traces/debug` pipeline so
  you get live console visibility in staging without changing prod.

## Why each sidecar lives next to its anchor

Discovery only applies a sidecar to a `service.pipelines` file in the
**same** directory, so the sidecar and the anchor `pipelines.yaml` sit
together inside `prod/` and `staging/`. The shared fragments stay in
`base/` and are referenced outward via `../base/...`. (A single
top-level sidecar referencing anchors *inside* subfolders would not be
applied — the anchor and sidecar must be siblings.)

## Run

```sh
# prod
otelcol-contrib \
  --config=examples/configset-shared-base/base/receivers.yaml \
  --config=examples/configset-shared-base/base/exporters.yaml \
  --config=examples/configset-shared-base/prod/pipelines.yaml

# staging
otelcol-contrib \
  --config=examples/configset-shared-base/base/receivers.yaml \
  --config=examples/configset-shared-base/base/exporters.yaml \
  --config=examples/configset-shared-base/staging/exporters.yaml \
  --config=examples/configset-shared-base/staging/pipelines.yaml
```

Compare with [`../configset-sidecar/`](../configset-sidecar/) for a
flat single-directory sidecar, and
[`../configset-directive/`](../configset-directive/) for the inline
first-line directive flavour.
