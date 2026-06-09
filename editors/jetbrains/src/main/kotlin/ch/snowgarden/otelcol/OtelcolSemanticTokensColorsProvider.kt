package ch.snowgarden.otelcol

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.psi.PsiFile
import com.redhat.devtools.lsp4ij.features.semanticTokens.DefaultSemanticTokensColorsProvider

// Maps LSP semantic token types emitted by otelcol-language-server to IntelliJ
// language-highlighter colors. Aligned with the VS Code styling in
// package.json#editor.semanticTokenColorCustomizations:
//   class      → component declarations (e.g. "otlp:" under receivers:)
//   namespace  → component references (e.g. "otlp" inside service.pipelines.*)
//
// Returning the default-highlighter keys (rather than hardcoded colors) lets
// each user's theme decide the actual palette — Darcula, IntelliJ Light, and
// custom themes all stay consistent with the rest of the editor.
class OtelcolSemanticTokensColorsProvider : DefaultSemanticTokensColorsProvider() {
  override fun getTextAttributesKey(
    tokenType: String,
    tokenModifiers: List<String>,
    file: PsiFile,
  ): TextAttributesKey? {
    val isDeclaration = "declaration" in tokenModifiers
    return when (tokenType) {
      "class" -> if (isDeclaration) {
        DefaultLanguageHighlighterColors.CLASS_NAME
      } else {
        DefaultLanguageHighlighterColors.CLASS_REFERENCE
      }
      "namespace" -> if (isDeclaration) {
        DefaultLanguageHighlighterColors.STATIC_FIELD
      } else {
        DefaultLanguageHighlighterColors.INSTANCE_FIELD
      }
      else -> super.getTextAttributesKey(tokenType, tokenModifiers, file)
    }
  }
}
