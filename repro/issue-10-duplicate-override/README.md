# Issue #10 repro — duplicate component id across config-set members

`file/sampled` is defined in `01_staging_exporters.yaml` and re-defined in
`97_test_exporters.yaml` (a later member), then referenced by the pipeline in
`99_pipelines.yaml`.

- **`main` (no fix):**
  - **error** `duplicate exporter id "file/sampled"` on BOTH defining sites
  - **error** `ambiguous reference "file/sampled" … resolve the duplicate before
this reference can be used` on the pipeline ref
- **`feat/10-duplicate-warning-suppression` worktree:**
  - **warning** `duplicate exporter id "file/sampled" overrides the earlier
definition … (last definition wins)` on the override site only
  - the pipeline reference resolves normally (no error)

## Try the suppression directive (worktree only)

Add this comment on the line directly above `file/sampled:` in
`97_test_exporters.yaml`:

```yaml
# otelcol-disable-next-line duplicate
file/sampled:
```

The override warning disappears. The same-line form works too:

```yaml
file/sampled: # otelcol-disable-line duplicate
```

On `main` these are just ordinary YAML comments and have no effect.
