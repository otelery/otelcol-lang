# JetBrains plugin — OpenTelemetry Collector

LSP4IJ-based plugin that delegates highlighting to the shared
TextMate grammars and all language intelligence to the standalone
`otelcol-language-server` process.

Works on IDEA / PyCharm / WebStorm / GoLand / CLion **Community** and
Ultimate. Requires the **LSP4IJ** plugin to be installed in the IDE.

## Prereqs

1. **LSP server on PATH**:

   ```sh
   # from repo root:
   npm run compile
   npm pack
   npm i -g ./vscode-otelcol-*.tgz
   which otelcol-language-server
   ```

2. **JDK 17+** (for the Gradle build).

## Dev install

```sh
cd editors/jetbrains
./gradlew runIde
```

This boots a sandbox IDE with the plugin loaded. The sandbox auto-
fetches LSP4IJ as a plugin dependency (see `build.gradle.kts` →
`intellijPlatform { plugin(...) }`).

In the sandbox:

1. Open the repo root as a project (`File → Open` → pick the
   `otelcol-lang-idea` directory).
2. Open `examples/simple/otelcol-config.yaml`.
3. The file currently has no `.otelcol.yaml` suffix — for the v0.1
   glob detection to fire, copy it to
   `otelcol-config.otelcol.yaml`. Alternatively, right-click the
   tab → `Override File Type` → `OpenTelemetry Collector`.

Verify:

- Status bar shows the LSP4IJ "otelcol" server as connected
  (View → Tool Windows → Language Servers).
- Hovering on `receivers:` shows Markdown component docs.
- Breaking a pipeline component reference produces a diagnostic
  squiggle.

## Layout

```
editors/jetbrains/
  build.gradle.kts          # IntelliJ Platform Gradle Plugin 2.x
  settings.gradle.kts
  gradle.properties         # plugin coords + LSP4IJ version
  src/main/
    kotlin/ch/snowgarden/otelcol/
      OtelcolLspServerFactory.kt    # spawns otelcol-language-server --stdio
      OtelcolTextMateBundle.kt      # registers ../syntaxes/ as a textmate bundle
      OtelcolFileType.kt            # glob registration (*.otelcol.yaml, ...)
    resources/
      META-INF/plugin.xml
      textmate/             # auto-populated by `copySyntaxes` gradle task
        otelcol-yaml.tmLanguage.json
        ottl.tmLanguage.json
        otelcol-substitution.injection.json
```

The `copySyntaxes` task in `build.gradle.kts` copies grammars from
`../../syntaxes/` on every build — the repo root remains the single
source of truth.

## Settings

For v0.1 the `otelcol.distribution = "otelcol-contrib"` default is
passed via `initializationOptions` in `OtelcolLspServerFactory`. A
proper IDE-level settings panel (`Configurable`) is a follow-up.
Override the LSP binary path with the system property
`-Dotelcol.lsp.command=/path/to/binary`.

## Testing

Plugin unit tests use the IntelliJ Platform test framework
(`BasePlatformTestCase`). They cover the filetype glob mapping,
the LSP server factory's command-build and initialization options,
and the plugin.xml extension wiring.

First-time setup (bootstraps the gradle wrapper — requires a system
`gradle` installation; install via SDKMAN or your package manager):

```sh
cd editors/jetbrains
gradle wrapper
```

Then:

```sh
cd editors/jetbrains
./gradlew test
# or via the umbrella entry (skips cleanly without java/gradle):
make test-jetbrains
```

Cross-IDE compatibility verification (slower, downloads multiple IDEs):

```sh
cd editors/jetbrains
./gradlew verifyPlugin
```

## Known gaps

- **No content-based filetype sniffing.** Files outside the glob
  patterns won't auto-detect, even with the `# otelcol-configset:`
  directive. Porting `src/common/yaml-classify.ts` to Kotlin is a
  follow-up.
- **TextMate engine divergences.** JetBrains' TextMate engine has
  documented differences from VS Code's around begin/end patterns
  with back-references. The grammars in `syntaxes/` work on both
  today; revisit if changes break JetBrains rendering.
- **No Configurable UI** for `otelcol.distribution` —
  see settings note above.
- **Embedded OTTL diagnostics** require `ottl-lsp` on PATH; document
  per the server's `otelcol.ottlLspPath` setting.
