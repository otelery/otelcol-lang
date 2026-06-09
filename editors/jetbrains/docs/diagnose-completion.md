# Diagnosing noisy / cross-level completions

**Symptom:** Ctrl+Space in an `.otelcol.yaml` file produces a huge popup with
entries that are valid at multiple nesting levels, even though the same file in
VS Code shows a tight, context-appropriate list.

The fix depends on *where* the noise comes from. Don't patch blindly — run the
5-minute diagnostic first, then pick the fix that matches what you found.

---

## Likely causes (ordered by probability)

1. **IntelliJ's built-in YAML completion is firing alongside the LSP one.** The
   bundled `org.jetbrains.plugins.yaml` plugin contributes its own completions:
   anchor names, prior-occurrence words from the buffer, and (if any JSON schema
   is associated with the file) every key in that schema at any depth. LSP4IJ
   does not suppress these. The popup ends up with `your LSP items + YAML
   plugin items` glued together, with no prefix filtering between sources.

2. **No prefix matching.** If the LSP server returns items with `filterText`
   unset and IntelliJ falls back to matching against an empty prefix at the
   line start, every item passes. Ctrl+Space on a blank line typically triggers
   this.

3. **Server returning too much.** Unlikely if VS Code shows a tight list at the
   same position — VS Code and JetBrains hit the same `textDocument/completion`
   endpoint — but worth ruling out.

---

## Diagnostic (5 minutes)

1. Open the LSP4IJ tool window: **View → Tool Windows → Language Servers**.
2. Expand `otelcol` → gear icon → enable `Trace: verbose` (or right-click → Trace).
3. Place the cursor where the popup misbehaves and hit Ctrl+Space.
4. Look at the LSP trace tab. Count the items in the `textDocument/completion`
   response and compare to the popup:

   | LSP returned | Popup shows | Cause                          |
   |--------------|-------------|--------------------------------|
   | 5            | ~30         | #1 — YAML plugin polluting     |
   | 30           | ~30 (matches VS Code) | #3 — server overshare |
   | 5            | ~30, extras look like words from the file | #2 — prefix/filter issue |

5. In the popup itself: hover over a non-LSP-looking entry. IntelliJ shows the
   contributing source in the docs tooltip / popup metadata. Anything sourced
   from `YAMLKeyCompletionContributor`, `WordCompletionContributor`, or
   `YamlJsonSchemaCompletionContributor` confirms cause #1.

---

## Fixes per cause

### #1 — YAML plugin pollution

Register an `LSPClientFeatures` for the otelcol server and override
`getCompletionFeature()` to suppress or downweight non-LSP completions.

LSP4IJ 0.19 does not expose a clean "exclusive completion" flag. The workable
approach is to add a `CompletionContributor` for the otelcol file type that
runs *after* LSP4IJ's contributor and calls `result.stopHere()` when the LSP
produced items, blocking the YAML plugin's contributor from running afterwards.

Rough sketch (~30 lines):

```kotlin
class OtelcolCompletionGate : CompletionContributor() {
  override fun fillCompletionVariants(parameters: CompletionParameters, result: CompletionResultSet) {
    if (parameters.originalFile.virtualFile?.name?.endsWith(".otelcol.yaml") != true) return
    // If LSP4IJ already produced any item, suppress everything that follows.
    if (LSPCompletionSupport.hasLspCompletions(parameters)) {
      result.stopHere()
    }
  }
}
```

Register in `plugin.xml` with `order="last"`. Verify the LSP contributor's
order so this runs strictly after it.

### #2 — No prefix matching

Override `LSPCompletionFeature.createLookupElement` (or register a custom
`LSPClientFeatures` and provide a `LSPCompletionFeature` subclass) so the
returned `LookupElement` carries a `prefixMatcher` derived from the
identifier-chars immediately preceding the cursor. That way empty-prefix
completion does not match every item.

### #3 — Server overshare

Out of JetBrains-plugin scope. Fix the server's `textDocument/completion`
handler in `src/server/completion.ts` (or equivalent) so the candidate set
is scoped by the YAML path under the cursor. The VS Code extension hits the
same endpoint, so any fix benefits all editors.

---

## After you fix it

Add a regression guard. Pinning the contract at the unit-test level is
cheap and catches future drift:

- **For #1**, add a test that opens an `.otelcol.yaml` fixture with both an
  LSP-eligible context AND a known YAML-plugin-completion trigger, and asserts
  that only LSP items appear (`myFixture.complete(CompletionType.BASIC)`,
  then assert the resulting lookup elements all come from the LSP source).
- **For #2**, add a test against `LSPCompletionFeature.createLookupElement`
  asserting the returned `LookupElement.getPrefixMatcher()` is non-empty when
  the cursor sits after a partial identifier.
- **For #3**, the test lives in the server repo, not here — add a fixture
  asserting `completion(line, col)` returns N items at a deeply-nested
  position.
