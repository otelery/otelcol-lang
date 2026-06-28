# Finalizing the Zed integration — implementation log

Captures the _why_ behind the changes that took the Zed extension
(`editors/zed/`) from functional Alpha (v0.1.0) to publish-ready, tracked
in [issue #13](https://github.com/otelery/otelcol-lang/issues/13). Companion
to the cargo tests under `editors/zed/tests/` and the packaged-tarball smoke
(`scripts/zed-package-smoke.sh`).

Each section: the gap, the chosen fix, and why the obvious alternative was
rejected.

## 1. Zero-config language-server delivery

**Gap.** VS Code and JetBrains bundle the language server; Zed required a
manual `npm i -g`. Zed's guidance is the opposite of bundling: an extension
"must not ship the language server as part of the extension" and should
instead locate or download it.

**Fix.** `editors/zed/src/otelcol.rs` resolves the server in three tiers,
first match wins:

1. **`lsp.otelcol.binary.path`** from settings — the escape hatch for
   developing the server out of a local checkout.
2. **`worktree.which("otelcol-language-server")`** — honours an existing
   global install / anything on `PATH`, so power users stay in control.
3. **npm auto-install** — `zed::npm_install_package("opentelemetry-collector-config", v)`
   into the extension work dir, then spawn the package's bin shim
   (`node_modules/opentelemetry-collector-config/bin/otelcol-language-server.js`)
   with Zed's bundled Node (`zed::node_binary_path()`) and `--stdio`.

`set_language_server_installation_status` drives the `Checking for
update…` / `Downloading…` UI; a failed install falls back to any
previously-installed copy before erroring.

**Why not `npm_install_package` by binary name?** Zed installs by _package_
name, but the npm package (`opentelemetry-collector-config`) differs from the
bin name (`otelcol-language-server`). That mismatch is exactly why naive
auto-install was a documented blocker — tier 3 installs the package
explicitly and resolves the bin path itself.

**Why not download a compiled per-OS binary (à la the Rust/Go extensions)?**
The server is a Node script, not a compiled binary; the repo publishes it to
npm, not as per-OS release assets. Reusing the npm artefact via Zed's bundled
Node is zero new build pipeline.

## 2. Version lockstep (0.1.0 → 0.5.1)

**Gap.** The extension was stranded at 0.1.0 while the repo shipped 0.5.1,
and `scripts/prepare-release.sh` only bumped `package.json` +
`gradle.properties`.

**Fix.** `prepare-release.sh` now also `sed`-bumps
`editors/zed/extension.toml` and `editors/zed/Cargo.toml` alongside the
existing registries, keeping all editors in lockstep (`Cargo.lock` is
gitignored — the registry regenerates it). The Rust extension installs the npm server at exactly
`env!("CARGO_PKG_VERSION")`, so a given extension release always pairs with
the server it was built against. `tests/extension_toml.rs::version_is_lockstep_with_crate`
fails the suite on a half-applied bump.

## 3. Icon + LICENSE for the registry

**Gap.** No icon (issue asked for parity with JetBrains `pluginIcon.svg`),
and the registry's per-subdirectory submission requires a license at the
extension path.

**Fix.** `editors/zed/icon.svg` (the shared OpenTelemetry mark, from the
JetBrains icon) ships in the package tarball. Zed's `extension.toml` has no
documented `icon` field today, so the asset is shipped for repo parity /
forward-compat rather than referenced from a key that would fail validation
(noted in `NOTES.md`). `editors/zed/LICENSE` is the repo's Apache-2.0 text,
required because the registry submission uses `path = "editors/zed"` and Zed
CI checks for a license at that path.

## 4. CI (the repo's first)

**Gap.** No `.github/workflows/` existed at all.

**Fix.** `.github/workflows/ci.yml` runs `make check` — the same gate
maintainers run locally (lint, format-check, typecheck, audit, unit +
per-editor tests incl. Zed, packaging dry-run). `make check` self-bootstraps
the pinned toolchains via mise into `.ci-tools/`, so the workflow only adds
caches keyed on the version pins.

## 5. Packaged smoke test

**Gap.** Zed tests were static TOML/query validation only; the issue asked
for something closer to end-to-end. There is no headless Zed harness (unlike
`@vscode/test-cli`).

**Fix.** `make test-zed-package` builds the release tarball and runs
`scripts/zed-package-smoke.sh`, which asserts the tarball carries everything
the registry build needs (`extension.toml`, `languages/`, `icon.svg`,
`LICENSE`, `otelcol_zed.wasm`), that the declared version matches the release
version, and that the WASM has valid module magic bytes. Wired into
`test-editors`, so it runs under `make check`/CI. Editor-free by design.

## 6. Publishing runbook

**Gap.** `make publish-zed` printed two vague lines.

**Fix.** It now prints the accurate `zed-industries/extensions` flow: fork,
add this repo as a git submodule, set `submodule` + `path = "editors/zed"` +
`version` in `extensions.toml`, check out the release tag, `pnpm
sort-extensions`, and open the PR (the registry builds the WASM and publishes
on merge). The whole repo is the submodule; the `path` points Zed at the
`editors/zed/` subdirectory — which is why the LICENSE in §3 lives there.

## Deferred (tracked in `editors/zed/NOTES.md`)

OTTL injection highlighting (needs a registered `ottl` tree-sitter grammar)
and the open detection-parity questions (`workspace/configuration` reload,
`first_line_pattern` scope, multi-file configset retagging) are out of scope
for publish-readiness and remain documented as known limitations.
