package ch.snowgarden.otelcol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Pure-logic mirror of the TS yaml-classify tests. No IDE platform needed, so
// these run fast and pin the line-based scanner against the same shapes the
// VS Code sniffer classifies.
class OtelcolYamlClassifyTest {
  @Test fun anchorHasPipelines() {
    val c = OtelcolYamlClassify.classify(
      """
      service:
        pipelines:
          traces:
            receivers: [otlp]
      """.trimIndent(),
    )
    assertTrue(c.hasPipelines)
    assertEquals(1, c.otelcolKeys)
  }

  @Test fun servicePipelinesMustBeDirectChild() {
    // `pipelines:` nested under telemetry, not directly under service.
    val c = OtelcolYamlClassify.classify(
      """
      service:
        telemetry:
          pipelines: nope
      """.trimIndent(),
    )
    assertFalse(c.hasPipelines)
  }

  @Test fun fragmentCountsOneKey() {
    val c = OtelcolYamlClassify.classify("receivers:\n  otlp:\n")
    assertEquals(1, c.otelcolKeys)
    assertTrue(c.hasFragmentKeys)
    assertFalse(c.hasPipelines)
  }

  @Test fun twoTopLevelKeys() {
    val c = OtelcolYamlClassify.classify("receivers:\n  otlp:\nexporters:\n  debug:\n")
    assertEquals(2, c.otelcolKeys)
  }

  @Test fun unrelatedYamlHasZeroKeys() {
    val c = OtelcolYamlClassify.classify("apiVersion: apps/v1\nkind: Deployment\n")
    assertEquals(0, c.otelcolKeys)
    assertFalse(c.hasFragmentKeys)
    assertNull(c.directive)
  }

  @Test fun directiveParsedFromFirstLine() {
    val c = OtelcolYamlClassify.classify("# otelcol-configset: base.yaml exporters.yaml\nexporters:\n  debug:\n")
    assertEquals(listOf("base.yaml", "exporters.yaml"), c.directive)
  }

  @Test fun directiveMarkerMatchesNonFirstLine() {
    // Marker (rule 1) matches anywhere; the captured name list only when first.
    val text = "exporters:\n# otelcol-configset: a.yaml\n"
    assertTrue(OtelcolYamlClassify.DIRECTIVE_MARKER_RE.containsMatchIn(text))
    assertNull(OtelcolYamlClassify.classify(text).directive)
  }

  @Test fun toleratesCrlf() {
    val c = OtelcolYamlClassify.classify("receivers:\r\n  otlp:\r\nexporters:\r\n  debug:\r\n")
    assertEquals(2, c.otelcolKeys)
  }
}
