// Confmap substitution parsing for the LSP server.
// Spec: editors/vscode/syntaxes/otelcol-substitution.injection.json
//
// Two forms are recognized:
//   Modern:  ${env:VAR}  /  ${env:VAR:-default}
//   Legacy:  ${VAR}  (deprecated by the OTel Collector, no default supported)
//
// Only whole-scalar substitutions (where the entire ref string is one
// substitution) make sense as component-id references. Embedded forms like
// "Bearer ${env:TOKEN}" are not pipeline component references and are ignored.

// Modern env-provider form.
const ENV_SCHEME_RE = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)(?::-([\s\S]*))?\}$/;
// yaml: provider — the opaque value is passed verbatim to the YAML parser, so it IS the component name.
const YAML_SCHEME_RE = /^\$\{yaml:([\s\S]*)\}$/;
// Legacy bare form — deprecated but still accepted by the collector.
const LEGACY_BARE_RE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
// Any confmap provider substitution (scheme = [A-Za-z][A-Za-z0-9+.-]+, min 2 chars).
// Used to detect unresolved substitutions whose value is only known at runtime (file:, http:, https:, …).
const ANY_SCHEME_RE = /^\$\{[A-Za-z][A-Za-z0-9+.\-]+:[\s\S]*\}$/;

/** Extract the component ID to look up from a raw scalar value.
 *
 * - `${env:VAR:-default}` → `"default"` (validate the default against declared components)
 * - `${yaml:VALUE}`       → `"VALUE"`   (statically known; yaml: passes the opaque value to the parser)
 * - `${env:VAR}` / `${VAR}` / `${file:…}` / anything else → `raw` (unresolvable; caller skips or gets a diagnostic)
 */
export function resolveRefId(raw: string): string {
  const envM = ENV_SCHEME_RE.exec(raw);
  if (envM && envM[2] !== undefined) return envM[2];
  const yamlM = YAML_SCHEME_RE.exec(raw);
  if (yamlM) return yamlM[1];
  return raw;
}

/**
 * Given the unquoted source-text slice of a scalar (i.e. the bytes between the
 * opening and closing quote characters, or the full token for plain scalars),
 * return [start, end) byte offsets of the default-value substring within that
 * slice, or null if the slice is not a `${env:VAR:-default}` substitution.
 *
 * Using the source slice (not Scalar.value) ensures correctness even when the
 * YAML scalar contains escape sequences, because the offsets must index into
 * the original source text.
 */
export function defaultValueOffsets(sourceSlice: string): [number, number] | null {
  if (!ENV_SCHEME_RE.test(sourceSlice)) return null;
  const colonDash = sourceSlice.indexOf(":-");
  const closingBrace = sourceSlice.lastIndexOf("}");
  if (colonDash === -1 || closingBrace === -1 || colonDash + 2 > closingBrace) return null;
  return [colonDash + 2, closingBrace];
}

/** True if the raw scalar is any recognized substitution form (modern, legacy, or any provider scheme). */
export function isSubstitution(raw: string): boolean {
  return ANY_SCHEME_RE.test(raw) || LEGACY_BARE_RE.test(raw);
}
