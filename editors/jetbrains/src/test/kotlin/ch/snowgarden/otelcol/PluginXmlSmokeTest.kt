package ch.snowgarden.otelcol

import com.intellij.testFramework.fixtures.BasePlatformTestCase

// Validates plugin.xml structure without booting a sandbox IDE.
// Catches typos in extension namespaces / factoryClass FQN before
// `runIde` would surface them.
class PluginXmlSmokeTest : BasePlatformTestCase() {
  private fun readPluginXml(): String {
    val url = javaClass.classLoader.getResource("META-INF/plugin.xml")
    assertNotNull("META-INF/plugin.xml not found on test classpath", url)
    return url!!.readText()
  }

  fun testPluginIdMatches() {
    val xml = readPluginXml()
    assertTrue("plugin.xml missing expected <id>", xml.contains("<id>ch.snowgarden.otelcol</id>"))
  }

  fun testLsp4ijDependency() {
    val xml = readPluginXml()
    assertTrue(
      "plugin.xml missing LSP4IJ dependency",
      xml.contains("com.redhat.devtools.lsp4ij"),
    )
  }

  fun testLspServerExtensionWiredToFactory() {
    val xml = readPluginXml()
    assertTrue(
      "plugin.xml missing LSP4IJ <server> extension",
      xml.contains("factoryClass=\"ch.snowgarden.otelcol.OtelcolLspServerFactory\""),
    )
  }

  fun testLanguageMappingPresent() {
    val xml = readPluginXml()
    assertTrue(
      "plugin.xml missing yaml→otelcol languageMapping",
      xml.contains("languageId=\"otelcol\"") && xml.contains("language=\"yaml\""),
    )
  }

  fun testFileTypeGlobsRegistered() {
    val xml = readPluginXml()
    for (glob in listOf("*.otelcol.yaml", "*.otelcol.yml")) {
      assertTrue("plugin.xml missing glob $glob", xml.contains(glob))
    }
  }

  fun testSemanticTokensColorsProviderRegistered() {
    // Without this extension the LSP `namespace`/`class` tokens render
    // unstyled. Pin the registration so a future refactor doesn't silently
    // regress to the "references are plain white" bug.
    val xml = readPluginXml()
    assertTrue(
      "plugin.xml missing semanticTokensColorsProvider registration",
      xml.contains("<semanticTokensColorsProvider") &&
        xml.contains("class=\"ch.snowgarden.otelcol.OtelcolSemanticTokensColorsProvider\""),
    )
  }

  fun testYamlPluginDependencyDeclared() {
    // The YAML plugin must be declared via <depends> (not just the
    // build-classpath bundledPlugin in build.gradle.kts) — otherwise the
    // strict production classloader rejects YAMLLanguage at FileType init.
    // This is a static guard alongside the live Plugin Verifier check.
    val xml = readPluginXml()
    assertTrue(
      "plugin.xml missing <depends>org.jetbrains.plugins.yaml</depends>",
      xml.contains("<depends>org.jetbrains.plugins.yaml</depends>"),
    )
  }
}
