# Config-set with a first-line directive

Multi-file config where membership and merge order are declared
inline at the top of the anchor file (the one containing
`service.pipelines:`):

```yaml
# configset-otelcol: base.yaml exporters.yaml pipelines.yaml
service:
  pipelines: ...
```

Use this pattern when you want the config-set declaration to live with
the file that owns the pipelines — no extra file in the directory.

## Run

```sh
otelcol-contrib \
  --config=examples/configset-directive/base.yaml \
  --config=examples/configset-directive/exporters.yaml \
  --config=examples/configset-directive/pipelines.yaml
```

## How the extension finds it

The extension scans the first line of every YAML file in the workspace
for a `# configset-otelcol:` comment. When it finds one, the members
listed (relative to the file containing the directive) form the
config-set.

Compare with [`../configset-sidecar/`](../configset-sidecar/) for the
sidecar-file flavour of the same pattern.
