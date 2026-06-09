package ch.snowgarden.otelcol

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.testFramework.fixtures.BasePlatformTestCase

// Unit-level coverage for the LSP semantic-token → IntelliJ TextAttributesKey
// mapping. Locked down here because the "references render as plain white"
// regression that prompted this provider has no parser-level test that would
// catch it: the symptom only shows up when the LSP server actually emits
// `namespace` tokens and the IDE has to choose a color for them.
//
// A full golden-file `myFixture.testHighlighting()` would also catch this, but
// requires booting the Node LSP and waiting for a semanticTokens response —
// that's an integration test, tracked separately. These unit tests pin the
// mapping contract; the integration layer can pin "LSP actually emits the
// tokens we expect" once IDE Starter is wired.
class OtelcolSemanticTokensColorsProviderTest : BasePlatformTestCase() {
  private val provider = OtelcolSemanticTokensColorsProvider()

  private fun key(type: String, vararg modifiers: String) =
    provider.getTextAttributesKey(type, modifiers.toList(), myFixture.configureByText("a.otelcol.yaml", ""))

  fun testNamespaceReferenceIsInstanceField() {
    // The user-visible symptom of the original "plain white" bug: a
    // `namespace` token without `declaration` is a component reference in
    // service.pipelines.*.{receivers,exporters,processors,connectors,extensions}.
    assertEquals(DefaultLanguageHighlighterColors.INSTANCE_FIELD, key("namespace"))
  }

  fun testNamespaceDeclarationIsStaticField() {
    assertEquals(DefaultLanguageHighlighterColors.STATIC_FIELD, key("namespace", "declaration"))
  }

  fun testClassReferenceIsClassReference() {
    assertEquals(DefaultLanguageHighlighterColors.CLASS_REFERENCE, key("class"))
  }

  fun testClassDeclarationIsClassName() {
    assertEquals(DefaultLanguageHighlighterColors.CLASS_NAME, key("class", "declaration"))
  }

  fun testUnknownTokenTypeFallsThroughToDefault() {
    // Unmapped LSP token types must delegate to LSP4IJ's
    // DefaultSemanticTokensColorsProvider — otherwise we silently swallow any
    // future token types the server starts emitting (function, variable, ...).
    // The default provider returns a non-null key for well-known LSP types
    // like `keyword`; we just assert it's not the otelcol-specific mapping.
    val k = key("keyword")
    assertNotSame(DefaultLanguageHighlighterColors.INSTANCE_FIELD, k)
    assertNotSame(DefaultLanguageHighlighterColors.CLASS_NAME, k)
  }
}
