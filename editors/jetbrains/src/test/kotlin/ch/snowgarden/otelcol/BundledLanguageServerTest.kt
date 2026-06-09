package ch.snowgarden.otelcol

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.nio.file.Files

// Guards the Gradle copyLanguageServer task output. Without these checks a
// missing/stale bundle would silently ship a broken plugin (the runtime
// extract step in OtelcolLspServerFactory would only blow up when a user
// opens an .otelcol.yaml file).
class BundledLanguageServerTest : BasePlatformTestCase() {
  fun testServerJsOnClasspath() {
    val url = javaClass.classLoader.getResource("language-server/server/server.js")
    assertNotNull("language-server/server/server.js missing — run `make bundle` then rebuild", url)
  }

  fun testManifestListsServerAndSchemas() {
    val stream = javaClass.classLoader.getResourceAsStream("language-server/manifest.txt")
    assertNotNull("language-server/manifest.txt missing — copyLanguageServer task did not run", stream)
    val entries = stream!!.bufferedReader().use { it.readLines() }.filter { it.isNotBlank() }
    assertTrue("manifest must list server/server.js, got: $entries", entries.contains("server/server.js"))
    assertTrue(
      "manifest must list at least one schema, got: $entries",
      entries.any { it.startsWith("schemas/") },
    )
  }

  fun testExtractedBundleIsRunnableJsFile() {
    val factory = OtelcolLspServerFactory()
    val path = factory.extractBundledServer()
    assertTrue("extracted server.js must exist: $path", Files.exists(path))
    assertTrue("extracted server.js must be non-empty", Files.size(path) > 0)
    val firstBytes = Files.newInputStream(path).use { it.readNBytes(64) }
    // esbuild output starts with the "use strict" pragma or a require() call;
    // either way the leading bytes should be printable ASCII, not a zip/jar header.
    assertFalse(
      "server.js appears to be a binary/archive, not JavaScript",
      firstBytes.isNotEmpty() && firstBytes[0] == 0x50.toByte() && firstBytes[1] == 0x4B.toByte(),
    )
  }
}
