# JetBrains (IDEA / CLion / GoLand / …) — otelcol language support

## Minimum-viable plugin shape

JetBrains has two paths for LSP integration, both gated by edition:

1. **Built-in LSP API** (`com.intellij.platform.lsp`) — official, but
   **Ultimate-only** as of 2024. Skips IDEA Community, CLion Community,
   PyCharm Community.
2. **LSP4IJ** (community plugin, JetBrains-blessed) — works on all
   editions, including Community. The realistic target.

Both reuse the existing TextMate grammars for highlighting (see
[SHARED.md §3](../SHARED.md#3-grammar-source-of-truth) — TM is kept
specifically for VS Code + JetBrains).

### Skeleton plugin (LSP4IJ route)

Plugin layout:

```
otelcol-jetbrains/
  build.gradle.kts
  src/main/
    kotlin/
      com/example/otelcol/
        OtelcolLspServerFactory.kt
    resources/
      META-INF/
        plugin.xml
      textmate/
        otelcol-yaml.tmLanguage.json   # copied from ../../syntaxes/
        ottl.tmLanguage.json            # copied from ../../syntaxes/
```

### `plugin.xml` (excerpt)

```xml
<idea-plugin>
  <id>com.example.otelcol</id>
  <name>OpenTelemetry Collector</name>
  <vendor>…</vendor>

  <depends>com.intellij.modules.platform</depends>
  <depends>com.redhat.devtools.lsp4ij</depends>
  <depends optional="true" config-file="textmate.xml">org.jetbrains.plugins.textmate</depends>

  <extensions defaultExtensionNs="com.redhat.devtools.lsp4ij">
    <server id="otelcol"
            name="OpenTelemetry Collector"
            factoryClass="com.example.otelcol.OtelcolLspServerFactory"/>
    <languageMapping language="yaml" serverId="otelcol"
                     languageId="otelcol"/>
  </extensions>

  <extensions defaultExtensionNs="org.jetbrains.plugins.textmate">
    <bundleProvider implementation="com.example.otelcol.OtelcolTextMateBundle"/>
  </extensions>
</idea-plugin>
```

### Server factory

```kotlin
class OtelcolLspServerFactory : LanguageServerFactory {
  override fun createConnectionProvider(project: Project): StreamConnectionProvider =
    ProcessStreamConnectionProvider(
      listOf("otelcol-language-server", "--stdio"),
      project.basePath
    )
}
```

Prereq: `npm i -g otelcol-language-server` — see
[SHARED.md §4](../SHARED.md#4-distribution-recommendation).

(Alternative: bundle a copy of `dist/` inside the plugin JAR and invoke
`node` with the absolute path. Removes the prereq but bloats the plugin and
ties releases together. Skip for v0.1.)

## Filetype detection

JetBrains gives us full programmatic control via `FileTypeRegistry` and
`FileTypeFactory`. We can replicate the extension's classifier exactly:

- File-name patterns (`*.otelcol.yaml`, `*.otelcol.yml`,
  `otelcol-configset.yaml`) registered via `FileNameMatcher`.
- Content sniffing via a custom `FileType` whose `isMyFileType(VirtualFile)`
  reads the first ~16KB and runs the same regex + top-level-key logic the
  extension uses. Worth porting the rules from
  `src/common/yaml-classify.ts` directly into Kotlin.

This makes JetBrains the only non-VS-Code editor with feature-parity
detection — see [SHARED.md §5](../SHARED.md#5-per-editor-is-this-an-otelcol-file-detection)
for the broader comparison.

## Packaging story

Two artifacts:

1. **JetBrains plugin** — published to the JetBrains Marketplace
   (`plugins.jetbrains.com`). Reviewed manually on first publish; subsequent
   versions go through automated checks. Marketplace handles per-IDE
   compatibility ranges via `since-build` / `until-build` in `plugin.xml`.
2. **LSP server** — `npm i -g otelcol-language-server`, same as every other
   editor.

Bundling the LSP into the plugin JAR is a deliberate non-choice — it
duplicates code, multiplies release coordination, and loses the
LSP-on-PATH versioning story. The prereq is a one-line install for users
already comfortable with the npm ecosystem; for users who aren't, document
prominently.

## Open questions

- **LSP4IJ vs built-in LSP API:** v0.1 should target LSP4IJ to cover
  Community editions. If/when adoption tilts to Ultimate users only, revisit.
- **TextMate bundle quirks:** JetBrains' TextMate engine has known
  divergences from VS Code's (especially around begin/end patterns with
  back-references). Test the existing `syntaxes/*.tmLanguage.json`
  against a representative `examples/*.yaml` before committing to the
  no-modifications path.
- **Markdown rendering in hover popups:** the server emits Markdown hovers
  (`MarkupKind.Markdown`). LSP4IJ renders them via its own pipeline; verify
  links, tables, and code blocks all survive the round-trip.
- **Schema setting:** `otelcol.distribution` needs an equivalent settings
  UI in the plugin. LSP4IJ does have a settings-passthrough mechanism;
  prefer that over building a custom `Configurable` panel for v0.1.
- **Embedded OTTL:** OTTL highlighting inside YAML strings via TextMate
  is awkward (embedded patterns scoped per-key). The TextMate grammar
  already handles this in VS Code — confirm JetBrains' TextMate engine
  honours the same embedded-language directives, or accept plain-string
  rendering inside OTTL bodies on JetBrains for v0.1.
