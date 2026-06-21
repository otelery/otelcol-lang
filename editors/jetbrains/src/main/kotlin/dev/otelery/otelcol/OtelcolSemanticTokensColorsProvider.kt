package dev.otelery.otelcol

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.psi.PsiFile
import com.redhat.devtools.lsp4ij.features.semanticTokens.DefaultSemanticTokensColorsProvider

// Maps LSP semantic token types emitted by otelcol-language-server to IntelliJ
// language-highlighter colors. Aligned with the VS Code styling in
// package.json#editor.semanticTokenColorCustomizations and the server's
// src/server/semantic-tokens.ts contract:
//   class      → component ids (receivers/processors/exporters/connectors/
//                extensions) and component references inside pipelines
//                + extension refs.
//   namespace  → pipeline ids and pipeline-id references inside routing /
//                failover connector configs.
//
// Returning the default-highlighter keys (rather than hardcoded colors) lets
// each user's theme decide the actual palette — Darcula, IntelliJ Light, and
// custom themes all stay consistent with the rest of the editor.
//
// We deliberately do NOT split by the `declaration` modifier. Mapping
// non-declaration `class` to CLASS_REFERENCE leaves it foreground-coloured
// (i.e. white) in stock Darcula, since CLASS_REFERENCE has empty default
// attributes — that's the "references are plain white" bug. Using CLASS_NAME
// for both declaration and reference matches VS Code, which paints both with
// the same colour (#E5C07B), and avoids the empty-attributes trap.
class OtelcolSemanticTokensColorsProvider : DefaultSemanticTokensColorsProvider() {
  override fun getTextAttributesKey(
    tokenType: String,
    tokenModifiers: List<String>,
    file: PsiFile,
  ): TextAttributesKey? = when (tokenType) {
    "class" -> DefaultLanguageHighlighterColors.CLASS_NAME
    "namespace" -> DefaultLanguageHighlighterColors.INSTANCE_FIELD
    else -> super.getTextAttributesKey(tokenType, tokenModifiers, file)
  }
}
