# JetBrains plugin — development loop

Three override channels are exposed by `OtelcolLspServerFactory`, in priority order:

| Channel                     | Where it lives      | Persistence         | Typical use                        |
| --------------------------- | ------------------- | ------------------- | ---------------------------------- |
| `-Dotelcol.lsp.command="…"` | JVM system property | Process lifetime    | Hand-rolled wrapper script; tests  |
| `-Dotelcol.lsp.server="…"`  | JVM system property | Process lifetime    | Source-tree `server.js` during dev |
| `otelcol.lsp.server.path`   | IntelliJ Registry   | Across IDE restarts | Persistent override on any IDE     |
| (none)                      | Bundled extraction  | Across IDE restarts | Production                         |

`-Dotelcol.lsp.node="…"` (also a system property) overrides the resolved `node` binary independently of the server path.

## Fast inner loop — sandbox IDE

```sh
make runide-jetbrains
```

This bundles the server (`make bundle`) and launches a sandboxed IntelliJ
instance with:

- the repo's `examples/` directory opened as the project (override with
  `./gradlew runIdeDev -PsandboxProject=/abs/path` from `editors/jetbrains/`);
- `-Dotelcol.lsp.server=…/dist/server/server.js` so the source-tree bundle is
  used in place of the extracted one.

After editing TypeScript and re-running `make bundle`: in the sandbox IDE,
**Tools → Restart otelcol Language Server**. No IDE restart needed.

### Auto-restart on rebuild

Set `OTELCOL_DEV_WATCH=1` in the IDE process environment. The
`OtelcolDevWatcher` `ProjectActivity` then watches the active
`server.js` (NIO `WatchService`, 300 ms debounce) and calls
`LanguageServerManager.stop + start` on change. `make runide-jetbrains`
sets this var already. The same variable name controls the VS Code
extension's auto-restart, so the opt-in is unified across editors.

Pair with a long-running `npm run watch` so esbuild rewrites
`dist/server/server.js` on every save — the watcher then bounces the
LSP server within ~1 second of the bundle landing.

The raw equivalent (no Make):

```sh
cd editors/jetbrains
./gradlew runIdeDev -Dotelcol.lsp.server="$(realpath ../../dist/server/server.js)"
```

## Persistent override (any IDE)

Help → Find Action → **Registry…** → set `otelcol.lsp.server.path` to an
absolute path. Then run the _Restart otelcol Language Server_ action to
pick it up. Clear the value to fall back to the bundled copy.

## Production install

```sh
make bundle && make build-jetbrains
# Install dist/packages/otelcol-jetbrains-0.1.0.zip via Settings → Plugins.
```

The runtime extraction cache at
`~/.cache/JetBrains/<IDE>/otelcol-language-server/<plugin-version>/` is now
keyed by a content hash (`manifest.sha256` shipped inside the jar). Installing
a freshly-built zip invalidates the cache automatically — no need to wipe the
directory by hand.

## Node discovery

`OtelcolLspServerFactory.resolveNode()` uses
`com.intellij.util.PathEnvironmentVariableUtil.findInPath("node", shellPath, null)`,
where `shellPath` comes from `EnvironmentUtil.getValue("PATH")` (the
shell-inherited PATH, not the IDE's launcher PATH). If lookup fails it falls
back to the literal `"node"` and relies on the spawned process inheriting the
shell env via `userEnvironmentVariables`. Use `-Dotelcol.lsp.node="/path/to/node"`
to override.

A future option (not implemented): mirror SonarLint's two-module SPI split so
Ultimate users can opt into `NodeJsInterpreterManager` (project-aware Node
selection) while Community stays on `PathEnvironmentVariableUtil`. The current
single-tier approach has been sufficient.
