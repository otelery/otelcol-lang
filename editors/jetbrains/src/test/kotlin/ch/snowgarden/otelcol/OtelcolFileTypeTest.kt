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

  // --- Content-based detection (isMyFileType) -------------------------------
  // These create real files in the in-memory test VFS and assert the resolved
  // file type, exercising the same rules as src/common/yaml-sniff.ts.

  fun testContentDetectsAnchor() {
    val vf = myFixture.addFileToProject(
      "anchor/pipelines.yaml",
      "service:\n  pipelines:\n    traces:\n      receivers: [otlp]\n",
    ).virtualFile
    assertEquals(OtelcolFileType.INSTANCE, vf.fileType)
  }

  fun testContentDetectsTwoKeyConfig() {
    val vf = myFixture.addFileToProject(
      "twokey/collector.yaml",
      "receivers:\n  otlp:\nexporters:\n  debug:\n",
    ).virtualFile
    assertEquals(OtelcolFileType.INSTANCE, vf.fileType)
  }

  fun testFragmentDetectedViaSiblingSidecar() {
    // Reproduces examples/configset-sidecar: a single-key fragment alongside
    // an otelcol-configset.yaml manifest. This is the case the old glob-only
    // detection missed.
    myFixture.addFileToProject("set/otelcol-configset.yaml", "members:\n  - base.yaml\n")
    val base = myFixture.addFileToProject(
      "set/base.yaml",
      "receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317\n",
    ).virtualFile
    assertEquals(OtelcolFileType.INSTANCE, base.fileType)
  }

  fun testFragmentDetectedViaSiblingAnchor() {
    myFixture.addFileToProject(
      "set2/pipelines.yaml",
      "service:\n  pipelines:\n    traces:\n      receivers: [otlp]\n",
    )
    val ex = myFixture.addFileToProject("set2/exporters.yaml", "exporters:\n  debug:\n").virtualFile
    assertEquals(OtelcolFileType.INSTANCE, ex.fileType)
  }

  fun testDirectiveMarkerDetected() {
    val vf = myFixture.addFileToProject(
      "dir/anything.yaml",
      "# otelcol-configset: a.yaml b.yaml\nexporters:\n  debug:\n",
    ).virtualFile
    assertEquals(OtelcolFileType.INSTANCE, vf.fileType)
  }

  fun testSiblingDirectiveNamesSelf() {
    myFixture.addFileToProject(
      "dir2/main.yaml",
      "# otelcol-configset: frag.yaml main.yaml\n" +
        "service:\n  pipelines:\n    traces:\n      receivers: [otlp]\n",
    )
    val frag = myFixture.addFileToProject("dir2/frag.yaml", "extensions:\n  health_check:\n").virtualFile
    assertEquals(OtelcolFileType.INSTANCE, frag.fileType)
  }

  fun testUnrelatedYamlNotDetected() {
    val vf = myFixture.addFileToProject(
      "k8s/deploy.yaml",
      "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: x\n",
    ).virtualFile
    assertNotSame(OtelcolFileType.INSTANCE, vf.fileType)
  }

  fun testLoneFragmentNotDetected() {
    // A single-key fragment with no sidecar and no anchor sibling stays YAML.
    val vf = myFixture.addFileToProject(
      "lonely/exporters.yaml",
      "exporters:\n  debug:\n",
    ).virtualFile
    assertNotSame(OtelcolFileType.INSTANCE, vf.fileType)
  }
}
