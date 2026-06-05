// Shared YAML classification primitive used by both the extension-side
// sniffer (deciding whether to retag a `yaml` document as `otelcol`) and the
// server-side ConfigSetIndex (deciding whether a file is an anchor /
// fragment / unrelated). Keeping the rules in one module prevents drift —
// the regex / parse approach has to stay in sync across both layers, and
// previously it did not (see the staging-blank-line regression).

import { parseDocument } from "yaml";

// Top-level keys that mark a file as part of an otelcol config. `service`
// is included because a file with just `service:` (no anchor) is still
// recognisable as collector-shaped content for retag purposes.
export const OTELCOL_TOP_KEYS = new Set([
  "service",
  "receivers",
  "processors",
  "exporters",
  "connectors",
  "extensions",
]);

// Fragment-only keys: a file with one of these (but no `service`) is a
// fragment that must be paired with an anchor to be meaningful. This is the
// set the server's configset discovery cares about.
export const FRAGMENT_KEYS = new Set([
  "receivers",
  "processors",
  "exporters",
  "connectors",
  "extensions",
]);

export const SIDECAR_NAME = "otelcol-configset.yaml";

// `# otelcol-configset:` — matches anywhere in the head (sniffer uses this
// for a "is this declared as part of a configset" check).
export const DIRECTIVE_MARKER_RE = /^#\s*otelcol-configset:/m;
// Same directive but captures the member list.
export const DIRECTIVE_NAMES_RE = /^#\s*otelcol-configset:\s*(.+)$/m;

export const HEAD_BYTES = 16 * 1024;

export interface YamlClassification {
  /** `service.pipelines` exists at the top level — this is an anchor. */
  hasPipelines: boolean;
  /** Number of top-level keys that match `OTELCOL_TOP_KEYS`. */
  otelcolKeys: number;
  /** Whether any top-level key is in `FRAGMENT_KEYS` (receivers/…/extensions). */
  hasFragmentKeys: boolean;
  /**
   * Members named by an `# otelcol-configset:` first-line directive, or `null`
   * if the file has no such directive. Names are returned verbatim (not
   * resolved to paths) — callers join with the file's directory.
   */
  directive: string[] | null;
}

const EMPTY: YamlClassification = {
  hasPipelines: false,
  otelcolKeys: 0,
  hasFragmentKeys: false,
  directive: null,
};

/**
 * Classify a YAML buffer (or its first ~16KB). Tolerant of syntax errors:
 * `parseDocument` returns a usable AST even when input is malformed, and we
 * read whatever structure the parser recovered. Files that don't parse at
 * all return the empty classification.
 */
export function classifyYaml(text: string): YamlClassification {
  const head = text.length > HEAD_BYTES ? text.slice(0, HEAD_BYTES) : text;
  const directive = parseDirective(head);

  let js: unknown;
  try {
    js = parseDocument(head).toJS();
  } catch {
    return { ...EMPTY, directive };
  }
  if (!js || typeof js !== "object") return { ...EMPTY, directive };

  const obj = js as Record<string, unknown>;
  const topKeys = Object.keys(obj);
  let otelcolKeys = 0;
  let hasFragmentKeys = false;
  for (const k of topKeys) {
    if (OTELCOL_TOP_KEYS.has(k)) otelcolKeys++;
    if (FRAGMENT_KEYS.has(k)) hasFragmentKeys = true;
  }
  const service = obj.service;
  const hasPipelines =
    !!service && typeof service === "object" && "pipelines" in (service as Record<string, unknown>);

  return { hasPipelines, otelcolKeys, hasFragmentKeys, directive };
}

function parseDirective(head: string): string[] | null {
  const firstNewline = head.indexOf("\n");
  const firstLine = firstNewline === -1 ? head : head.slice(0, firstNewline);
  const m = /^#\s*otelcol-configset:\s*(.+)$/.exec(firstLine);
  if (!m) return null;
  return m[1].trim().split(/\s+/).filter(Boolean);
}
