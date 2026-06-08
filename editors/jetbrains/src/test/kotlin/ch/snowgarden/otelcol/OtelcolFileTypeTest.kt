package ch.snowgarden.otelcol

import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class OtelcolFileTypeTest : BasePlatformTestCase() {
  fun testGlobMatchesOtelcolYaml() {
    val ft = FileTypeManager.getInstance().getFileTypeByFileName("foo.otelcol.yaml")
    assertEquals(OtelcolFileType.INSTANCE, ft)
  }

  fun testGlobMatchesOtelcolYml() {
    val ft = FileTypeManager.getInstance().getFileTypeByFileName("bar.otelcol.yml")
    assertEquals(OtelcolFileType.INSTANCE, ft)
  }

  fun testGlobMatchesConfigsetSidecar() {
    val ft = FileTypeManager.getInstance().getFileTypeByFileName("otelcol-configset.yaml")
    assertEquals(OtelcolFileType.INSTANCE, ft)
  }

  fun testPlainYamlNotMatched() {
    val ft = FileTypeManager.getInstance().getFileTypeByFileName("foo.yaml")
    assertNotSame(OtelcolFileType.INSTANCE, ft)
  }

  fun testFileTypeNameStable() {
    // Marketplace listings key off the name; regressions here break
    // user-side file-type associations.
    assertEquals("OpenTelemetry Collector", OtelcolFileType.INSTANCE.name)
    assertEquals("otelcol.yaml", OtelcolFileType.INSTANCE.defaultExtension)
  }
}
