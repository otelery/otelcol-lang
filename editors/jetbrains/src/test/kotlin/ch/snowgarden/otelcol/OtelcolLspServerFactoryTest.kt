package ch.snowgarden.otelcol

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.redhat.devtools.lsp4ij.server.ProcessStreamConnectionProvider

class OtelcolLspServerFactoryTest : BasePlatformTestCase() {
  fun testDefaultCommandUsesPathBin() {
    System.clearProperty("otelcol.lsp.command")
    val factory = OtelcolLspServerFactory()
    val provider = factory.createConnectionProvider(project) as ProcessStreamConnectionProvider
    val commands = provider.commands
    assertNotNull("provider must expose its commands", commands)
    assertEquals(listOf("otelcol-language-server", "--stdio"), commands)
  }

  fun testCommandOverrideViaSystemProperty() {
    System.setProperty("otelcol.lsp.command", "/tmp/fake-otelcol-lsp")
    try {
      val factory = OtelcolLspServerFactory()
      val provider = factory.createConnectionProvider(project) as ProcessStreamConnectionProvider
      assertEquals(listOf("/tmp/fake-otelcol-lsp", "--stdio"), provider.commands)
    } finally {
      System.clearProperty("otelcol.lsp.command")
    }
  }

  @Suppress("UNCHECKED_CAST")
  fun testInitializationOptionsCarryDistribution() {
    val factory = OtelcolLspServerFactory()
    val provider = factory.createConnectionProvider(project)
    val opts = provider.getInitializationOptions(null) as Map<String, Any>
    val otelcol = opts["otelcol"] as Map<String, Any>
    assertEquals("otelcol-contrib", otelcol["distribution"])
    val configSets = otelcol["configSets"] as Map<String, Any>
    assertEquals(true, configSets["autoDiscover"])
    assertEquals(2000, configSets["maxFilesScanned"])
  }
}
