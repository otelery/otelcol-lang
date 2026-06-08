; Inject OTTL into YAML string values under keys that carry OTTL
; statements/conditions (transform processor, filter processor, ...).
;
; This query is a no-op until an `ottl` language is registered in
; Helix — the LSP forwards OTTL diagnostics regardless, this only
; affects syntax highlighting of the embedded text.
;
; Node names match tree-sitter-yaml as bundled by Helix. If a future
; Helix release changes the YAML grammar, retighten here.

((block_mapping_pair
   key: (flow_node) @_key
   value: (block_node (block_scalar) @injection.content))
 (#match? @_key "^(statements|conditions)$")
 (#set! injection.language "ottl"))

((block_mapping_pair
   key: (flow_node) @_key
   value: (flow_node (flow_sequence (flow_node (plain_scalar) @injection.content))))
 (#match? @_key "^(statements|conditions)$")
 (#set! injection.language "ottl"))
