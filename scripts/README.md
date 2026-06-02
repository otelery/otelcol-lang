# `scripts/`

Build-time helpers and developer tools. None are bundled into the
published `.vsix` — they only run from the repo.

Each script has a header comment with the full rationale; the table
below is the at-a-glance index.

| script                    | purpose                                                                                                                                                                                                                                                           | invoked by                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `copy-schemas.mjs`        | Copies the vendored `schemas/` tree next to the compiled server — into `out/` for unit tests (`tsc` output) and into `dist/` for the VSIX (`esbuild` output) — so the LSP resolves schemas relative to its own bundle at runtime.                                 | `make build` and `make bundle` (via `esbuild.js`). |
| `check-runtime-paths.mjs` | Guards the invariant that runtime code under `src/extension/` and `src/server/` never `path.join` / `asAbsolutePath` / `import` a string literal `"out"` — the runtime must load peers from `dist/`, not from the `tsc` output that the dev loop doesn't refresh. | `make test-unit`.                                  |
| `smoke.mjs`               | Headless validator. `node scripts/smoke.mjs <file.yaml>` parses a single config and prints model + diagnostics; `--set <dir>` scans a directory as a workspace, discovers config sets, and validates each across its members.                                     | `npm run smoke -- <file>` or directly.             |
| `hover-probe.mjs`         | Headless hover diagnostic. `node scripts/hover-probe.mjs <file.yaml> <line>:<col>` or `… /<key_name>` (locate-by-key). Useful when iterating on hover content without round-tripping through the extension host.                                                  | Run by hand.                                       |

`copy-schemas.mjs` and `check-runtime-paths.mjs` are build-pipeline
load-bearing; `smoke.mjs` and `hover-probe.mjs` are developer tools
with no CI consumer.
