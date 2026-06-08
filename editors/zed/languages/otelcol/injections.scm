; Inject OTTL into YAML string values under keys that carry OTTL
; statements/conditions (transform processor, filter processor, ...).
;
; This is a no-op until an `ottl` language is registered (no ottl
; grammar ships in v0.1). The LSP still produces OTTL diagnostics —
; only embedded *highlighting* is affected.

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
