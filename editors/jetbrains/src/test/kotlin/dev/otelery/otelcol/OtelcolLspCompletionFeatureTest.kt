package dev.otelery.otelcol

import com.intellij.testFramework.fixtures.BasePlatformTestCase

// Pure-string unit tests for the snippet-tab rewrite logic. The companion
// helper is exercised in isolation so we don't need to spin up the full
// LSP4IJ pipeline. End-to-end tests live in OtelcolCompletionTest.
class OtelcolLspCompletionFeatureTest : BasePlatformTestCase() {

  fun testNoTabNoChange() {
    val out = OtelcolLspCompletionFeature.rewriteTabsToSpaces("foo: \$0")
    assertEquals("foo: \$0", out)
  }

  fun testNoNewlineLeavesTabsAlone() {
    // Tabs on the same line as the cursor are not continuation indent —
    // could be inside an identifier or literal, leave untouched.
    val out = OtelcolLspCompletionFeature.rewriteTabsToSpaces("foo\tbar")
    assertEquals("foo\tbar", out)
  }

  fun testArrayTabBecomesIndentUnit() {
    // The bug shape: `key:\n\t- $0`. The rewrite replaces `\t` with the
    // *relative* INDENT_UNIT only — LSP4IJ prepends the cursor line's
    // indent on its own when applying the snippet.
    val out = OtelcolLspCompletionFeature.rewriteTabsToSpaces("metadata_keys:\n\t- \$0")
    assertEquals("metadata_keys:\n  - \$0", out)
  }

  fun testObjectTabBecomesIndentUnit() {
    val out = OtelcolLspCompletionFeature.rewriteTabsToSpaces("protocols:\n\t\$0")
    assertEquals("protocols:\n  \$0", out)
  }
}
