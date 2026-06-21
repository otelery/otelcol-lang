# otelcol-lang

![banner](docs/assets/otel-logo.png)

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square)](LICENSE)

Syntax highlighting, completion, hover, diagnostics and embedded OTTL for OpenTelemetry Collector configs.

`otelcol-lang` is editor tooling for [OpenTelemetry Collector][otelcol] configurations: completion, hover docs, diagnostics, cross-file references and embedded OTTL, delivered through one shared LSP server plus a thin integration per editor. The package ships as `opentelemetry-collector-config` on the VS Code Marketplace and npm; this repo directory is `otelcol-lang-release`.

[otelcol]: https://github.com/open-telemetry/opentelemetry-collector

## Table of Contents

- [Supported editors](#supported-editors)
- [Install](#install)
- [Usage](#usage)
- [Schemas](#schemas)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Supported editors

| Editor    | Status      | Integration                                          | Per-editor README                                    |
| --------- | ----------- | ---------------------------------------------------- | ---------------------------------------------------- |
| VS Code   | Beta        | Bundled extension (TextMate grammar + LSP)           | [`editors/vscode/`](editors/vscode/README.md)        |
| Zed       | Alpha       | Rust → WASM extension; LSP via PATH                  | [`editors/zed/`](editors/zed/README.md)              |
| Helix     | Alpha       | `languages.toml` + tree-sitter queries; LSP via PATH | [`editors/helix/`](editors/helix/README.md)          |
| JetBrains | Beta        | LSP4IJ-based plugin; TextMate grammar bundle         | [`editors/jetbrains/`](editors/jetbrains/README.md)  |
| Neovim    | Development | Notes only; no shipped integration yet               | [`editors/neovim/NOTES.md`](editors/neovim/NOTES.md) |

Status uses the [OpenTelemetry Collector stability levels][stability]: **Development** (experimental; may change or be removed) → **Alpha** (works, but the schema may change) → **Beta** (functionally complete, breaking changes unlikely) → **Stable** (breaking changes require a deprecation cycle).

[stability]: https://github.com/open-telemetry/opentelemetry-collector/blob/main/docs/component-stability.md

## Install

Install the artefact for your editor, either from the editor's registry where a published release exists (see each per-editor README), or by building it from a checkout:

```sh
make package-<editor>     # vscode | zed | helix | jetbrains → dist/packages/
```

Then install the resulting file into the editor. Full per-editor install and dev-loop instructions are in [docs/BUILD.md](docs/BUILD.md).

## Usage

Open any YAML file that looks like an OpenTelemetry Collector configuration. The language is detected automatically by either:

- a first-line comment such as `# otelcol` or `# opentelemetry-collector`, or
- a recognised filename pattern (declared per distribution in the schemas repo's `distributions.yaml`).

You can also pin a distribution explicitly via the `# yaml-language-server:` pragma:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/otelery/otelcol-schemas/main/schemas/json/datadog-otelcol-config-0.152.0.json
receivers:
  otlp:
```

## Schemas

Validation, hover and completion are driven by JSON Schemas produced by a separate project, [`otelcol-schemas`](https://github.com/otelery/otelcol-schemas), which are **vendored** into this repo and bundled at build time. The current bundle covers seven distributions: `otelcol`, `otelcol-contrib`, `otelcol-k8s`, `otelcol-otlp`, `otelcol-ebpf-profiler`, `datadog-otelcol`, `elastic-otelcol`. Refreshing the vendored copy: [docs/BUILD.md#schema-source](docs/BUILD.md#schema-source).

## Documentation

- [docs/BUILD.md](docs/BUILD.md): build, test, package, install per editor, refresh schemas.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): repo layout, the LSP server and settings, cross-file references, the editor-injection design.
- [docs/RELEASING.md](docs/RELEASING.md): the prepare → publish release runbook.
- [editors/SHARED.md](editors/SHARED.md): cross-editor design notes.
- [docs/investigations/](docs/investigations/): research write-ups (JetBrains dev loop, completion, IntelliJ LSP).

## Contributing

Issues and pull requests are welcome. Ask questions and report bugs via the GitHub issue tracker. Before opening a PR, run `make check` (all quality gates); see [docs/BUILD.md](docs/BUILD.md) for the build/test workflow and [docs/RELEASING.md](docs/RELEASING.md) for how releases are cut.

## License

[Apache-2.0](LICENSE) © otelery.
