package ch.snowgarden.otelcol

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.testFramework.fixtures.BasePlatformTestCase

// Unit-level coverage for the LSP semantic-token → IntelliJ TextAttributesKey
// mapping. Locked down here because the "references render as plain white"
// regression that prompted this provider has no parser-level test that would
// catch it: the symptom only shows up when the LSP server actually emits
// `class` tokens for references and the IDE has to choose a colour for them.
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

  fun testClassMapsToClassName() {
    // Component ids — `class` covers both definition sites and references.
    // The user-visible symptom of the original "plain white" bug was that
    // class references mapped to CLASS_REFERENCE, which has empty default
    // attributes in stock Darcula. Pinning CLASS_NAME for both keeps them
    // visibly coloured (yellow in Darcula, matches VS Code's #E5C07B).
    assertEquals(DefaultLanguageHighlighterColors.CLASS_NAME, key("class"))
    assertEquals(DefaultLanguageHighlighterColors.CLASS_NAME, key("class", "declaration"))
    assertEquals(DefaultLanguageHighlighterColors.CLASS_NAME, key("class", "declaration", "deprecated"))
  }

  fun testNamespaceMapsToInstanceField() {
    // Pipeline ids — both definitions and references render the same colour
    // (purple in Darcula, matches VS Code's #C678DD).
    assertEquals(DefaultLanguageHighlighterColors.INSTANCE_FIELD, key("namespace"))
    assertEquals(DefaultLanguageHighlighterColors.INSTANCE_FIELD, key("namespace", "declaration"))
  }

  fun testUnknownTokenTypeFallsThroughToDefault() {
    // Unmapped LSP token types must delegate to LSP4IJ's
    // DefaultSemanticTokensColorsProvider — otherwise we silently swallow any
    // future token types the server starts emitting (function, variable, ...).
    // The default provider returns a non-null key for well-known LSP types
    // like `keyword`; we just assert it's not the otelcol-specific mapping.
    val k = key("keyword")
    assertNotSame(DefaultLanguageHighlighterColors.CLASS_NAME, k)
    assertNotSame(DefaultLanguageHighlighterColors.INSTANCE_FIELD, k)
  }
}
