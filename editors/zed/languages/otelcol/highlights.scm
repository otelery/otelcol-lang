; otelcol highlights — vendored from Zed's stock YAML query set
; (crates/grammars/src/yaml/highlights.scm at zed-industries/zed).
;
; Zed treats this file as the authoritative highlight query for the
; `OpenTelemetry Collector` language; there is no inheritance
; mechanism the way Helix/Neovim have one. A near-empty file produces
; no captures and renders the document in the default foreground
; colour — that's the bug this file fixes.
;
; The LSP layers semantic tokens (component-type / unused-id) on top
; via `src/server/semantic-tokens.ts`.

(boolean_scalar) @boolean

(null_scalar) @constant.builtin

[
  (double_quote_scalar)
  (single_quote_scalar)
  (block_scalar)
  (string_scalar)
] @string

(escape_sequence) @string.escape

[
  (integer_scalar)
  (float_scalar)
] @number

(comment) @comment

[
  (anchor_name)
  (alias_name)
  (tag)
] @type

key: (flow_node
  [
    (plain_scalar
      (string_scalar))
    (double_quote_scalar)
    (single_quote_scalar)
  ] @property)

[
  ","
  "-"
  ":"
  ">"
  "?"
  "|"
] @punctuation.delimiter

[
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  "*"
  "&"
  "---"
  "..."
] @punctuation.special
