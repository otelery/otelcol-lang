package ch.snowgarden.otelcol

import com.intellij.codeInsight.lookup.LookupElement
import com.redhat.devtools.lsp4ij.client.features.LSPCompletionFeature
import org.eclipse.lsp4j.CompletionItem
import org.eclipse.lsp4j.InsertTextFormat
import org.eclipse.lsp4j.InsertTextMode

// JetBrains-side safety net for snippet indentation.
//
// LSP4IJ inserts multi-line completion snippets verbatim — its
// LspSnippetIndentOptions (features/completion/snippet/) translates only
// `\t` → N-spaces and `\n` → line-separator. It does NOT prepend the
// cursor line's leading whitespace to continuation lines. The client
// capabilities advertise both `InsertTextMode.AsIs` and `AdjustIndentation`
// (see internal/capabilities/ClientCapabilitiesFactory.java:156), but
// LSPCompletionContributor only stores the value (line 248) — no code
// path actually branches on it. So `AdjustIndentation` items behave like
// `AsIs` in LSP4IJ today, while vscode-languageclient honours them.
//
// Our own server (src/server/completion.ts) sidesteps this by baking
// only the *relative* INDENT_UNIT into the snippet and pinning
// InsertTextMode.AsIs. This feature is the defence-in-depth: any LSP
// CompletionItem that arrives with a `\t` continuation gets rewritten in
// place (both insertText and textEdit.newText). Catches future server
// regressions and bridges other LSP servers that follow the more common
// `\t`-snippet idiom.
//
// Long-term: upstream LSP4IJ should honour the advertised
// `AdjustIndentation` mode by walking continuation lines and prepending
// the cursor line's leading whitespace. When that lands, this class
// becomes redundant — the rewrite is a no-op anyway when the snippet
// has no `\t`.
class OtelcolLspCompletionFeature : LSPCompletionFeature() {
  override fun createLookupElement(
    item: CompletionItem,
    context: LSPCompletionContext,
  ): LookupElement? {
    if (item.insertTextFormat == InsertTextFormat.Snippet) {
      // Rewrite both fields — LSP4IJ may apply either depending on what
      // the server sent (textEdit takes precedence when present).
      val insertText = item.insertText
      if (insertText != null && needsRewrite(insertText)) {
        item.insertText = rewriteTabsToSpaces(insertText)
        item.insertTextMode = InsertTextMode.AsIs
      }
      val textEdit = item.textEdit
      if (textEdit != null && textEdit.isLeft) {
        val newText = textEdit.left?.newText
        if (newText != null && needsRewrite(newText)) {
          textEdit.left.newText = rewriteTabsToSpaces(newText)
          item.insertTextMode = InsertTextMode.AsIs
        }
      }
    }
    return super.createLookupElement(item, context)
  }

  private fun needsRewrite(text: String): Boolean = text.contains('\t') && text.contains('\n')

  companion object {
    private const val INDENT_UNIT = "  "

    // Replace each `\t` in continuation lines (everything after the first
    // newline) with INDENT_UNIT. LSP4IJ prepends the cursor line's leading
    // whitespace to every continuation line on its own, so the snippet
    // body carries only the *relative* extra indent. Pairing with
    // InsertTextMode.AsIs prevents any further client-side adjustment.
    internal fun rewriteTabsToSpaces(snippet: String): String {
      val firstNl = snippet.indexOf('\n')
      if (firstNl < 0) return snippet
      val head = snippet.substring(0, firstNl + 1)
      val tail = snippet.substring(firstNl + 1)
      return head + tail.replace("\t", INDENT_UNIT)
    }
  }
}
