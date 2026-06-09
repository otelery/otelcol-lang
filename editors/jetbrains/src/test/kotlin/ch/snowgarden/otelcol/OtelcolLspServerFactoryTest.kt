package ch.snowgarden.otelcol

import com.intellij.testFramework.fixtures.BasePlatformTestCase

class OtelcolLspServerFactoryTest : BasePlatformTestCase() {
  override fun tearDown() {
    System.clearProperty(OtelcolLspServerFactory.PROP_COMMAND)
    System.clearProperty(OtelcolLspServerFactory.PROP_NODE)
    super.tearDown()
  }

  fun testDefaultCommandSpawnsBundledServer() {
    System.clearProperty(OtelcolLspServerFactory.PROP_COMMAND)
    System.clearProperty(OtelcolLspServerFactory.PROP_NODE)
    val cmd = OtelcolLspServerFactory().buildCommand()
    assertEquals("expected [node, <server.js>, --stdio]", 3, cmd.size)
    assertEquals("node", cmd[0])
    assertTrue("server.js path expected, got ${cmd[1]}", cmd[1].endsWith("server.js"))
    assertEquals("--stdio", cmd[2])
  }

  fun testNodeBinaryOverride() {
    System.setProperty(OtelcolLspServerFactory.PROP_NODE, "/opt/node22/bin/node")
    val cmd = OtelcolLspServerFactory().buildCommand()
    assertEquals("/opt/node22/bin/node", cmd[0])
    assertTrue(cmd[1].endsWith("server.js"))
    assertEquals("--stdio", cmd[2])
  }

  fun testFullCommandOverride() {
    System.setProperty(OtelcolLspServerFactory.PROP_COMMAND, "/tmp/fake-otelcol-lsp")
    val cmd = OtelcolLspServerFactory().buildCommand()
    assertEquals(listOf("/tmp/fake-otelcol-lsp", "--stdio"), cmd)
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
