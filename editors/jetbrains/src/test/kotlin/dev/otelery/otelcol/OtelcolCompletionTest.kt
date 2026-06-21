package dev.otelery.otelcol

import com.intellij.codeInsight.lookup.Lookup
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.redhat.devtools.lsp4ij.LanguageServerManager
import java.util.concurrent.TimeUnit

// End-to-end completion tests that exercise LSP4IJ's client-side application
// of LSP CompletionItems — the layer where today's JetBrains indentation bug
// lived (server emitted spec-correct items; LSP4IJ over-indented continuation
// lines and scanned the replacement range back to column 0).
//
// Unit tests under test/unit-completion.test.mjs already defend the LSP
// contract (item shape, textEdit range, insertTextMode). These tests defend
// the *post-acceptance buffer contents*, which the unit tests can't observe.
//
// Mirror tests exist in editors/vscode/test/integration/extension.test.ts for
// the VS Code side of the same four scenarios.
class OtelcolCompletionTest : BasePlatformTestCase() {

  override fun setUp() {
    super.setUp()
    // Start the LSP server up-front and block until it's initialized.
    // Tests are synchronous; LSP completion is async — without this the
    // first completeBasic() runs before the server can answer.
    val mgr = LanguageServerManager.getInstance(project)
    mgr.start("otelcol")
    mgr.getLanguageServer("otelcol").get(60, TimeUnit.SECONDS)
  }

  // 1. Multi-line snippet indent — array property under a 4-space-indented
  //    blank line. `metadata_keys:` must land at col 4; `- ` at col 6.
  fun testArraySnippetIndentsCorrectly() {
    myFixture.configureByText(
      "config.otelcol.yaml",
      """
      |processors:
      |  batch:
      |    <caret>
      """.trimMargin(),
    )
    selectLookup("metadata_keys")
    // Trailing space after `-` is the snippet's `$0` cursor position.
    assertBufferEquals(
      "processors:\n  batch:\n    metadata_keys:\n      - ",
    )
  }

  // 2. textEdit range pinning — typing `met` on a 4-space-indented line and
  //    accepting `metadata_keys` must NOT eat the leading indent.
  fun testTextEditPreservesLeadingIndent() {
    myFixture.configureByText(
      "config.otelcol.yaml",
      """
      |processors:
      |  batch:
      |    met<caret>
      """.trimMargin(),
    )
    selectLookup("metadata_keys")
    // Trailing space after `-` is the snippet's `$0` cursor position.
    assertBufferEquals(
      "processors:\n  batch:\n    metadata_keys:\n      - ",
    )
  }

  // 3. Sibling-key filtering — keys already present in the mapping aren't
  //    re-suggested (would otherwise create a YAML duplicate-key error).
  fun testSiblingKeysFilteredFromSuggestions() {
    myFixture.configureByText(
      "config.otelcol.yaml",
      """
      |processors:
      |  batch:
      |    send_batch_size: 1024
      |    timeout: 5s
      |    <caret>
      """.trimMargin(),
    )
    val labels = myFixture.completeBasic().map { it.lookupString }
    assertFalse("send_batch_size is already set — must not be suggested", labels.contains("send_batch_size"))
    assertFalse("timeout is already set — must not be suggested", labels.contains("timeout"))
    assertTrue(
      "metadata_keys is not yet defined — should still surface; got: $labels",
      labels.contains("metadata_keys"),
    )
  }

  // 4. keyOnLine carve-out — cursor parked on an existing key line still
  //    surfaces that key, so re-editing / replacing it works.
  fun testKeyOnLineStillSuggested() {
    myFixture.configureByText(
      "config.otelcol.yaml",
      """
      |receivers:
      |  otlp:
      |    protocols:
      |      grpc:
      |        end<caret>point: 0.0.0.0:4317
      """.trimMargin(),
    )
    val labels = myFixture.completeBasic().map { it.lookupString }
    assertTrue(
      "cursor is on `endpoint:` itself — must still appear in suggestions; got: $labels",
      labels.contains("endpoint"),
    )
  }

  private fun assertBufferEquals(expected: String) {
    val actual = myFixture.editor.document.text
    if (actual != expected) {
      val visualise: (String) -> String = { it.replace(" ", "·").replace("\n", "↵\n") }
      fail(
        "buffer mismatch\n--- expected ---\n${visualise(expected)}\n--- actual ---\n${visualise(actual)}\n",
      )
    }
  }

  // Lookup helper. completeBasic() returns the full suggestion list and
  // opens the lookup popup; we pick by lookupString and let LSP4IJ apply
  // the chosen LSP CompletionItem via its normal accept path.
  private fun selectLookup(lookupString: String) {
    val items = myFixture.completeBasic()
    val match = items.firstOrNull { it.lookupString == lookupString }
      ?: error("no lookup element with string '$lookupString' — got: ${items.map { it.lookupString }}")
    myFixture.lookup.currentItem = match
    myFixture.finishLookup(Lookup.NORMAL_SELECT_CHAR)
  }
}
