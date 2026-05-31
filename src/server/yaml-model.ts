// Parse a collector config YAML into a model carrying offsets back to the
// source. The model is intentionally narrow — only the structures the LSP
// reasons about (component maps, pipelines, OTTL-bearing strings).

import { parseDocument, YAMLMap, YAMLSeq, Scalar, Pair, isMap, isSeq, isScalar, isPair, Node } from "yaml";
import type { Position, Range } from "vscode-languageserver";
import type { ComponentClass } from "./components";

export interface DocModel {
  sourceUri: string;
  text: string;
  // Map class -> { id -> { idRange, configRange } }
  components: Record<ComponentClass, Map<string, ComponentEntry>>;
  pipelines: PipelineEntry[];
  // service.extensions: [a, b, c] — each entry is a reference to a top-level
  // `extensions.<id>` definition. Tracked separately from pipeline refs
  // because extensions don't participate in the pipeline graph.
  serviceExtensions: PipelineRef[];
  // Refs to `extensions.<id>` scraped from anywhere inside a component's
  // config tree — auth.authenticator, storage, encoding, watch_observers,
  // additional_auth, oauthbearer_token_source.
  extensionRefs: ExtensionRef[];
  // Refs to pipeline ids inside connector configs — routing's
  // default_pipelines/table.pipelines, failover's priority_levels.
  pipelineIdRefs: PipelineIdRef[];
  ottlBlocks: OttlBlock[];
  diagnostics: ParseDiagnostic[];
  // Lookup table: byte offset -> path segments (for completion/hover context).
  rangeForKey: Map<Node, Range>;
}

export interface ExtensionRef {
  id: string;
  sourceUri: string;
  range: Range;
  fieldPath: string;
  // Strict refs are reported as errors when unresolved (auth/storage/observer/etc.).
  // Soft refs cover ambiguous fields (encoding can be a built-in format name OR
  // an extension id) — we emit a ref so cross-file F12 works when it does
  // resolve, but skip the diagnostic otherwise.
  strict: boolean;
}

export interface PipelineIdRef {
  id: string;
  sourceUri: string;
  range: Range;
  fieldPath: string;
}

export interface ComponentEntry {
  id: string;
  type: string;
  name?: string;
  sourceUri: string;
  idRange: Range;
  configRange: Range;
  configNode: Node | null;
}

export interface PipelineRef {
  id: string;
  sourceUri: string;
  range: Range;
}

export interface PipelineEntry {
  id: string;
  signal: string; // traces / metrics / logs / profiles
  name?: string;
  sourceUri: string;
  range: Range;
  receivers: PipelineRef[];
  processors: PipelineRef[];
  exporters: PipelineRef[];
}

export interface OttlBlock {
  kind: "statement" | "condition";
  text: string;
  sourceUri: string;
  range: Range;
}

export interface ParseDiagnostic {
  message: string;
  sourceUri: string;
  range: Range;
  severity: "error" | "warning";
}

const CLASSES: ComponentClass[] = ["receiver", "processor", "exporter", "connector", "extension"];
const CLASS_KEYS: Record<string, ComponentClass> = {
  receivers: "receiver",
  processors: "processor",
  exporters: "exporter",
  connectors: "connector",
  extensions: "extension",
};

// Keys whose immediate sequence-of-strings is a list of OTTL statements/conditions.
// Some (log_statements, trace_statements, …) carry a list of *maps* whose inner
// `statements:` / `conditions:` sub-keys hold the actual OTTL — handled by the
// walker recursing past the outer key.
const OTTL_STATEMENT_KEYS = new Set(["statements"]);
const OTTL_CONDITION_KEYS = new Set([
  "conditions",
  "log_record",
  "span",
  "spanevent",
  "metric",
  "datapoint",
  "span_conditions",
  "datapoint_conditions",
  "spanevent_conditions",
  "metric_conditions",
  "resource_conditions",
  "scope_conditions",
  "profile_conditions",
]);
const OTTL_SCALAR_KEYS = new Map<string, "statement" | "condition">([
  ["statement", "statement"],
  ["condition", "condition"],
]);

export function buildModel(text: string, sourceUri: string = ""): DocModel {
  const model: DocModel = {
    sourceUri,
    text,
    components: { receiver: new Map(), processor: new Map(), exporter: new Map(), connector: new Map(), extension: new Map() },
    pipelines: [],
    serviceExtensions: [],
    extensionRefs: [],
    pipelineIdRefs: [],
    ottlBlocks: [],
    diagnostics: [],
    rangeForKey: new Map(),
  };

  const doc = parseDocument(text, { keepSourceTokens: true });
  for (const err of doc.errors) {
    model.diagnostics.push({
      message: err.message,
      sourceUri,
      range: rangeFromOffsets(text, err.pos[0], err.pos[1]),
      severity: "error",
    });
  }
  if (!isMap(doc.contents)) return model;

  for (const pair of doc.contents.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const cls = CLASS_KEYS[key];
    if (cls && isMap(pair.value)) {
      collectComponents(text, model, cls, pair.value, sourceUri);
    } else if (key === "service" && isMap(pair.value)) {
      collectService(text, model, pair.value, sourceUri);
    }
  }

  // Walk the tree once more to harvest OTTL ranges anywhere they appear.
  walkOttl(text, model, doc.contents, sourceUri);

  return model;
}

function collectComponents(text: string, model: DocModel, cls: ComponentClass, map: YAMLMap, sourceUri: string) {
  for (const pair of map.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const id = String(pair.key.value);
    const slash = id.indexOf("/");
    const type = slash === -1 ? id : id.slice(0, slash);
    const name = slash === -1 ? undefined : id.slice(slash + 1);
    const idRange = nodeRange(text, pair.key as Node);
    const configRange = pair.value ? nodeRange(text, pair.value as Node) : idRange;
    model.components[cls].set(id, {
      id,
      type,
      name,
      sourceUri,
      idRange,
      configRange,
      configNode: (pair.value as Node) ?? null,
    });
    // Scrape cross-references buried in the component's config tree.
    if (pair.value && (isMap(pair.value) || isSeq(pair.value))) {
      const basePath = `${pluralize(cls)}.${id}`;
      scrapeExtensionRefs(text, pair.value as Node, basePath, null, sourceUri, model.extensionRefs);
      if (cls === "connector") {
        scrapeConnectorPipelineRefs(text, type, pair.value as Node, basePath, sourceUri, model.pipelineIdRefs);
      }
    }
  }
}

function pluralize(cls: ComponentClass): string {
  return cls + "s";
}

// Direct scalar fields whose value is an extension id. Some are strict (must
// resolve), others are soft (resolved if it matches an extension, ignored
// otherwise — covers cases like `encoding: json` which is a built-in format,
// not a ref).
const DIRECT_EXT_REF_STRICT = new Set(["storage", "additional_auth"]);
const DIRECT_EXT_REF_SOFT = new Set(["encoding", "oauthbearer_token_source"]);
// Sequence-of-extension-id fields.
const SEQ_EXT_REF_STRICT = new Set(["watch_observers"]);

function scrapeExtensionRefs(
  text: string,
  node: Node,
  path: string,
  parentKey: string | null,
  sourceUri: string,
  out: ExtensionRef[],
): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      const key = String(pair.key.value);
      const val = pair.value as Node | null;
      const childPath = `${path}.${key}`;
      // auth.authenticator: <ext id>  (parent must be "auth", key must be "authenticator", value scalar).
      if (parentKey === "auth" && key === "authenticator" && val && isScalar(val) && typeof (val as Scalar).value === "string") {
        out.push({ id: String((val as Scalar).value), sourceUri, range: nodeRange(text, val), fieldPath: childPath, strict: true });
        continue;
      }
      // Direct scalar extension refs.
      if ((DIRECT_EXT_REF_STRICT.has(key) || DIRECT_EXT_REF_SOFT.has(key)) && val && isScalar(val) && typeof (val as Scalar).value === "string") {
        out.push({
          id: String((val as Scalar).value),
          sourceUri,
          range: nodeRange(text, val),
          fieldPath: childPath,
          strict: DIRECT_EXT_REF_STRICT.has(key),
        });
        continue;
      }
      // Sequence extension refs.
      if (SEQ_EXT_REF_STRICT.has(key) && val && isSeq(val)) {
        for (const item of (val as YAMLSeq).items) {
          if (isScalar(item) && typeof item.value === "string") {
            out.push({ id: String(item.value), sourceUri, range: nodeRange(text, item as Node), fieldPath: `${childPath}[]`, strict: true });
          }
        }
        continue;
      }
      // Recurse into children — refs can appear at any depth (auth nested under tls etc.).
      if (val) scrapeExtensionRefs(text, val, childPath, key, sourceUri, out);
    }
  } else if (isSeq(node)) {
    const seq = node as YAMLSeq;
    for (let i = 0; i < seq.items.length; i++) {
      const item = seq.items[i] as Node;
      if (item) scrapeExtensionRefs(text, item, `${path}[${i}]`, parentKey, sourceUri, out);
    }
  }
}

// Connector-type-specific scrapers for pipeline-id references.
function scrapeConnectorPipelineRefs(
  text: string,
  type: string,
  node: Node,
  basePath: string,
  sourceUri: string,
  out: PipelineIdRef[],
): void {
  if (!isMap(node)) return;
  if (type === "routing") {
    for (const pair of node.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      const key = String(pair.key.value);
      if (key === "default_pipelines" && isSeq(pair.value)) {
        pushSeq(text, pair.value as YAMLSeq, `${basePath}.default_pipelines`, sourceUri, out);
      }
      if (key === "table" && isSeq(pair.value)) {
        const tbl = pair.value as YAMLSeq;
        for (let i = 0; i < tbl.items.length; i++) {
          const row = tbl.items[i];
          if (!isMap(row)) continue;
          for (const rp of row.items) {
            if (!isPair(rp) || !isScalar(rp.key)) continue;
            if (rp.key.value === "pipelines" && isSeq(rp.value)) {
              pushSeq(text, rp.value as YAMLSeq, `${basePath}.table[${i}].pipelines`, sourceUri, out);
            }
          }
        }
      }
    }
  } else if (type === "failover") {
    for (const pair of node.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      if (pair.key.value === "priority_levels" && isSeq(pair.value)) {
        const lvls = pair.value as YAMLSeq;
        for (let i = 0; i < lvls.items.length; i++) {
          const level = lvls.items[i];
          if (isSeq(level)) {
            pushSeq(text, level as YAMLSeq, `${basePath}.priority_levels[${i}]`, sourceUri, out);
          }
        }
      }
    }
  }
}

function pushSeq(text: string, seq: YAMLSeq, fieldPath: string, sourceUri: string, out: PipelineIdRef[]): void {
  for (const item of seq.items) {
    if (isScalar(item) && typeof item.value === "string") {
      out.push({ id: String(item.value), sourceUri, range: nodeRange(text, item as Node), fieldPath });
    }
  }
}

function collectService(text: string, model: DocModel, svc: YAMLMap, sourceUri: string) {
  for (const pair of svc.items) {
    if (!isPair(pair) || !isScalar(pair.key)) continue;
    const keyName = String(pair.key.value);
    if (keyName === "extensions" && isSeq(pair.value)) {
      for (const item of pair.value.items) {
        if (!isScalar(item)) continue;
        model.serviceExtensions.push({
          id: String(item.value),
          sourceUri,
          range: nodeRange(text, item as Node),
        });
      }
      continue;
    }
    if (pair.key.value !== "pipelines" || !isMap(pair.value)) continue;
    for (const pp of pair.value.items) {
      if (!isPair(pp) || !isScalar(pp.key) || !isMap(pp.value)) continue;
      const id = String(pp.key.value);
      const slash = id.indexOf("/");
      const signal = slash === -1 ? id : id.slice(0, slash);
      const name = slash === -1 ? undefined : id.slice(slash + 1);
      const entry: PipelineEntry = {
        id,
        signal,
        name,
        sourceUri,
        range: nodeRange(text, pp.key as Node),
        receivers: [],
        processors: [],
        exporters: [],
      };
      for (const inner of pp.value.items) {
        if (!isPair(inner) || !isScalar(inner.key) || !isSeq(inner.value)) continue;
        const k = String(inner.key.value);
        const bucket: PipelineRef[] | undefined =
          k === "receivers" ? entry.receivers : k === "processors" ? entry.processors : k === "exporters" ? entry.exporters : undefined;
        if (!bucket) continue;
        for (const item of inner.value.items) {
          if (!isScalar(item)) continue;
          bucket.push({ id: String(item.value), sourceUri, range: nodeRange(text, item as Node) });
        }
      }
      model.pipelines.push(entry);
    }
  }
}

function walkOttl(text: string, model: DocModel, node: Node | null, sourceUri: string) {
  if (!node) return;
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isPair(pair) || !isScalar(pair.key)) {
        if (isPair(pair)) walkOttl(text, model, pair.value as Node, sourceUri);
        continue;
      }
      const k = String(pair.key.value);
      const val = pair.value as Node;
      const isStmtKey = OTTL_STATEMENT_KEYS.has(k);
      const isCondKey = OTTL_CONDITION_KEYS.has(k);
      if ((isStmtKey || isCondKey) && isSeq(val)) {
        let captured = false;
        for (const item of val.items) {
          if (isScalar(item) && typeof item.value === "string") {
            model.ottlBlocks.push({
              kind: isStmtKey ? "statement" : "condition",
              text: item.value,
              sourceUri,
              range: nodeRange(text, item as Node),
            });
            captured = true;
          }
        }
        // The seq items were maps, not OTTL scalars — recurse so nested keys are reached.
        if (!captured) walkOttl(text, model, val, sourceUri);
      } else if (OTTL_SCALAR_KEYS.has(k) && isScalar(val) && typeof val.value === "string") {
        model.ottlBlocks.push({
          kind: OTTL_SCALAR_KEYS.get(k)!,
          text: val.value,
          sourceUri,
          range: nodeRange(text, val as Node),
        });
      } else {
        walkOttl(text, model, val, sourceUri);
      }
    }
  } else if (isSeq(node)) {
    for (const item of node.items) walkOttl(text, model, item as Node, sourceUri);
  }
}

function nodeRange(text: string, node: Node | null): Range {
  if (!node || !(node as any).range) return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const [start, valueEnd] = (node as any).range as [number, number, number];
  return rangeFromOffsets(text, start, valueEnd);
}

export function rangeFromOffsets(text: string, start: number, end: number): Range {
  return { start: posFromOffset(text, start), end: posFromOffset(text, end) };
}

export function posFromOffset(text: string, offset: number): Position {
  if (offset < 0) offset = 0;
  if (offset > text.length) offset = text.length;
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

export function offsetFromPos(text: string, pos: Position): number {
  let line = 0;
  let i = 0;
  while (i < text.length && line < pos.line) {
    if (text.charCodeAt(i) === 10) line++;
    i++;
  }
  return i + pos.character;
}

// Find the ancestor chain of YAML keys at a given byte offset. Used by completion.
export function pathAtOffset(text: string, offset: number): string[] {
  const doc = parseDocument(text, { keepSourceTokens: true });
  const path: string[] = [];
  function walk(node: Node | null): boolean {
    if (!node || !(node as any).range) return false;
    const r = (node as any).range as [number, number, number];
    if (offset < r[0] || offset > r[2]) return false;
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isPair(pair) || !isScalar(pair.key)) continue;
        const v = pair.value as Node | null;
        if (v && (v as any).range) {
          const vr = (v as any).range as [number, number, number];
          if (offset >= vr[0] && offset <= vr[2]) {
            path.push(String(pair.key.value));
            walk(v);
            return true;
          }
        }
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        if (walk(item as Node)) return true;
      }
    }
    return false;
  }
  if (doc.contents) walk(doc.contents as Node);
  return path;
}

export { CLASS_KEYS };
