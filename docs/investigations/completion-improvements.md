# Completion improvements — reasoning log

Captures the *why* behind the five completion-related fixes landed in
`src/server/completion.ts` and `src/server/yaml-model.ts`. Companion to
the cross-editor end-to-end tests under
`editors/{jetbrains,vscode}/.../*Completion*` that defend these
invariants.

Each section: the symptom, the root cause, the chosen fix, why the
obvious alternative was rejected. Read in order — the fixes build on
each other.

## 1. Multi-line snippet bodies use relative indent + `InsertTextMode.AsIs`

**Symptom.** Accepting a schema-derived array property (e.g.
`metadata_keys` under `processors.batch`) placed the array marker `- `
at the wrong column. VS Code rendered it correctly; JetBrains via LSP4IJ
landed it at column 0 + tab-width.

**Root cause.** The original snippet body was `${key}:\n\t- $0`. The
`\t` relied on the *client* to combine it with the cursor line's indent
when expanding. `vscode-languageclient` does this (it implements
`InsertTextMode.AdjustIndentation`). LSP4IJ does not: it expands `\t`
to a fixed N-space run with no contextual prepending (see
`/home/dol/project/lab/observability/lsp4ij/snippet-indent-analysis.md`
for the upstream-side analysis).

**Fix.** Snippet body carries only the *relative* `INDENT_UNIT` (two
spaces, matching YAML's convention) on continuation lines, and items
ship `insertTextMode: InsertTextMode.AsIs`. The LSP spec says both
`AsIs` and `AdjustIndentation` prepend the cursor line's indent to
continuation lines, so a relative-only snippet works in every
spec-compliant client.

```ts
const INDENT_UNIT = "  ";
if (t === "object") return `${key}:\n${INDENT_UNIT}$0`;
if (t === "array") return `${key}:\n${INDENT_UNIT}- $0`;
```

**Why not bake absolute indent into the snippet.** Tried first. Broke
VS Code's adjustment by double-indenting the continuation. Forced a
choice between spec-compliant and JetBrains-compatible. Relative indent
+ `AsIs` is both.

## 2. Explicit `textEdit.range` pinned to the typed prefix

**Symptom.** When the user typed `met` at column 4 on an otherwise
4-space-indented blank line and accepted `metadata_keys`, the inserted
key landed at column 0 — the leading indent had been replaced too.

**Root cause.** Without a `textEdit`, LSP4IJ's client computes the
replacement range from line start, eating the indent. vscode-languageclient
stops at the first non-identifier character (correctly preserving
whitespace).

**Fix.** Every property-completion item now carries an explicit
`textEdit.range` pinned to the identifier prefix only. `wordStartBefore`
scans back over `[A-Za-z0-9_]` from the cursor; everything before that
column stays untouched.

```ts
const prefixStart = wordStartBefore(doc.text, pos);
const editRange = { start: { line: pos.line, character: prefixStart }, end: pos };
// item: { textEdit: { range: editRange, newText: body }, insertText: body, ... }
```

`insertText` is kept as a fallback for clients that ignore `textEdit`.

**Why not rely on the client's heuristic.** The heuristics differ. Only
an explicit range gives identical behaviour everywhere.

## 3. Sibling-key filter via `siblingKeysAt`, with `keyOnLine` carve-out

**Symptom.** Triggering completion under `batch:` with `timeout` and
`send_batch_size` already set listed them again — accepting either
would create a YAML duplicate-key error.

**Root cause.** Completion walked the schema's `properties` and emitted
every match. The model had no awareness of which keys were already
present in the cursor's parent mapping.

**Fix.** New helper in `src/server/yaml-model.ts`:

```ts
export function siblingKeysAt(text: string, keyPath: string[]): Set<string>
```

Parses the YAML, navigates the path, returns the keys of the resolved
mapping. Completion filters those out of the suggestion set.

**The carve-out.** Without further care, parking the cursor on
`endpoint:` itself made `endpoint` disappear from completion — which
breaks the natural "re-edit / replace" flow. `keyOnLine(text, line)`
detects the key (if any) on the cursor's line and excludes it from the
"already exists" set. Net result: a re-edit re-suggests the same key;
a fresh sibling does not.

## 4. Blank-line path resolution: trust an explicit indent

**Symptom.** Cursor at column 4 on a blank line, two lines below a
`      - item` array entry under `metadata_keys`, returned zero
completions.

**Root cause.** `pathAtPosition`'s blank-line fallback (originally
written for LSP4IJ's "reported column 0 on virtual indent" case) was
firing whenever `position.character <= lineLeading`. With cursor and
leading-whitespace both at 4, the fallback raised `cursorIndent` to
match the previous non-blank line — `      - ff` at indent 6 — and
resolved the path as `["processors","batch","metadata_keys"]`. That's
inside the array, which has no `properties` → empty completion list.

**Fix.** Only fall back when *both* the reported column and the
existing whitespace are zero. An explicit non-zero column is the
user's committed indent; honour it.

```ts
if (cursorIndent === 0 && lineLeading === 0) {
  // ... look back at previous non-blank for context
}
```

**Why this is safe.** The original LSP4IJ-column-0 case still triggers
(both column and leading whitespace are zero on a freshly-pressed
Enter). The bug fix only changes behaviour when the cursor sits at a
positive column.

## 5. Default-value pre-fill via `${1:default}`

**Symptom.** Accepting a scalar property with a known schema default
gave `endpoint: |` — cursor right after the colon, user has to look up
the sensible default themselves.

**Fix.** When the schema has `default`, the snippet pre-fills it as a
tab-stop placeholder:

```ts
if (schema.default !== undefined) {
  const lit = typeof schema.default === "string"
    ? schema.default
    : JSON.stringify(schema.default);
  return `${key}: \${1:${lit}}`;
}
```

Cursor lands on the placeholder; user can accept (Tab) or replace
(start typing). For non-string defaults we serialise via
`JSON.stringify` so booleans/numbers/arrays come out unquoted /
correctly quoted.

## Test surface

Each fix is defended at three layers:

| Layer | Where |
|---|---|
| LSP item shape | `test/unit-completion.test.mjs` |
| stdio end-to-end | `test/integration-completion.test.mjs` |
| Post-acceptance buffer | `editors/jetbrains/.../OtelcolCompletionTest.kt` + `editors/vscode/test/integration/extension.test.ts` |

The unit layer catches server-side regressions; the post-acceptance
layer catches client-side regressions (LSP4IJ vs vscode-languageclient
divergence). The Revert 1–4 verification (see git history of B6) maps
which layer fails for which kind of regression.

## Cross-references

- LSP4IJ-side analysis of the `AdjustIndentation` gap that motivated
  fix #1 and #2: `/home/dol/project/lab/observability/lsp4ij/snippet-indent-analysis.md`.
- Defence-in-depth Kotlin safety net for `\t`-bearing snippets coming
  from any server: `editors/jetbrains/src/main/kotlin/.../OtelcolLspCompletionFeature.kt`.
