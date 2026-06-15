import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  InsertTextMode,
  Position,
} from "vscode-languageserver";
import type { ComponentsIndex, ComponentClass } from "./components";
import { findComponent } from "./components";
import { pathAtPosition, siblingKeysAt, valueContextAtPosition } from "./yaml-model";
import {
  resolveRef,
  lookupProperty,
  schemaTypeLabel,
  formatSchemaPropertyMarkdown,
  type JsonSchemaNode,
} from "./hover";
import type { SetModel } from "./set-model";

const PARENT_TO_CLASS: Record<string, ComponentClass> = {
  receivers: "receiver",
  processors: "processor",
  exporters: "exporter",
  connectors: "connector",
  extensions: "extension",
};

export function completion(
  model: SetModel,
  uri: string,
  idx: ComponentsIndex,
  pos: Position,
): CompletionItem[] {
  const doc = model.members.get(uri);
  if (!doc) return [];

  // Value-position: cursor sits after `key: ` on the same line. If the
  // resolved schema for that key has an `enum`, surface its values; otherwise
  // fall through (nothing useful to suggest for free-form scalars).
  const valueCtx = valueContextAtPosition(doc.text, pos);
  if (valueCtx) {
    const enumItems = enumValuesForKeyPath(model, idx, valueCtx.keyPath);
    if (enumItems) return enumItems;
  }

  const segs = pathAtPosition(doc.text, pos);

  // Inside one of the top-level component maps: suggest known types.
  const top = segs[0];
  const cls = PARENT_TO_CLASS[top];
  if (cls && segs.length === 1) {
    return idx.components[cls].map((c) => ({
      label: c.type,
      kind: CompletionItemKind.Class,
      detail: `${cls} (${c.signals.join(", ") || "n/a"})`,
      documentation: c.description
        ? { kind: "markdown" as const, value: c.description }
        : undefined,
    }));
  }

  // Inside a component instance (receivers.<id>[.foo.bar...]): walk the
  // component's JSON Schema along the trailing path and suggest property
  // keys at the cursor's depth.
  if (cls && segs.length >= 2) {
    const id = segs[1];
    const entry = model.components[cls].get(id);
    if (entry) {
      const comp = findComponent(idx, cls, entry.type);
      const baseSchema = (comp?.schema as JsonSchemaNode) ?? { type: "object" };
      const refRoot: JsonSchemaNode = {
        $defs: {
          ...(idx.defs as Record<string, JsonSchemaNode>),
          ...baseSchema.$defs,
        },
      };
      let node: JsonSchemaNode | null = resolveRef(baseSchema, refRoot);
      for (let i = 2; i < segs.length && node; i++) {
        node = lookupProperty(node, segs[i], refRoot);
      }
      if (node && node.properties) {
        const required = new Set(node.required ?? []);
        // Don't suggest keys that already exist as siblings in this mapping —
        // re-inserting one creates a YAML duplicate-key error. Exception:
        // the key on the cursor's own line is what the user is editing, so
        // it must stay in the list (otherwise typing a prefix of an existing
        // key would yield zero suggestions).
        const allSiblings = siblingKeysAt(doc.text, segs);
        const ownKey = keyOnLine(doc.text, pos.line);
        const existing = new Set(allSiblings);
        if (ownKey) existing.delete(ownKey);
        // Anchor the replacement range to the typed prefix only — LSP4IJ
        // otherwise scans back to column 0 and eats the leading indent,
        // landing inserted keys at the wrong column. Identifier prefix =
        // [A-Za-z0-9_].
        const prefixStart = wordStartBefore(doc.text, pos);
        const editRange = {
          start: { line: pos.line, character: prefixStart },
          end: pos,
        };
        return Object.entries(node.properties).flatMap(([key, raw]) => {
          if (existing.has(key)) return [];
          const sub = resolveRef(raw, refRoot);
          const t = schemaTypeLabel(sub);
          const detailBits = [t, required.has(key) ? "required" : null].filter(Boolean);
          const body = snippetForProperty(key, sub);
          return {
            label: key,
            kind: CompletionItemKind.Property,
            detail: detailBits.join(" · ") || undefined,
            documentation: {
              kind: "markdown" as const,
              value: formatSchemaPropertyMarkdown(key, sub),
            },
            // textEdit pins the replacement to the typed identifier prefix.
            // insertText kept as a fallback for clients that ignore textEdit.
            textEdit: { range: editRange, newText: body },
            insertText: body,
            insertTextFormat: InsertTextFormat.Snippet,
            // AsIs: take the snippet verbatim. We bake the cursor line's
            // indent into multi-line snippets ourselves, so we don't want
            // VS Code's adjustIndentation to re-apply it on top.
            insertTextMode: InsertTextMode.asIs,
          };
        });
      }
    }
  }

  // Inside service.pipelines.<sig>: suggest the bucket names.
  if (segs[0] === "service" && segs[1] === "pipelines" && segs.length === 3) {
    const bucketDetails: Record<string, string> = {
      receivers: "data sources feeding this pipeline",
      processors: "ordered list of transforms",
      exporters: "data sinks for this pipeline",
    };
    return ["receivers", "processors", "exporters"].map((k) => ({
      label: k,
      kind: CompletionItemKind.Property,
      detail: bucketDetails[k],
    }));
  }

  // Inside service.pipelines.<sig>.{receivers,processors,exporters}: suggest defined IDs.
  if (segs[0] === "service" && segs[1] === "pipelines" && segs.length >= 4) {
    const bucket = segs[3];
    const refCls: ComponentClass | undefined =
      bucket === "receivers"
        ? "receiver"
        : bucket === "processors"
          ? "processor"
          : bucket === "exporters"
            ? "exporter"
            : undefined;
    if (!refCls) return [];
    const ids: CompletionItem[] = [];
    for (const [id, entry] of model.components[refCls]) {
      ids.push({
        label: id,
        kind: CompletionItemKind.Reference,
        detail: `${refCls} · type ${entry.type}`,
      });
    }
    for (const [id, entry] of model.components.connector) {
      ids.push({
        label: id,
        kind: CompletionItemKind.Reference,
        detail: `connector · type ${entry.type}`,
      });
    }
    return ids;
  }

  // Top-level keys.
  if (segs.length === 0) {
    const topDetails: Record<string, string> = {
      receivers: "component map: data sources",
      processors: "component map: transforms",
      exporters: "component map: data sinks",
      connectors: "component map: pipeline bridges (act as exporter + receiver)",
      extensions: "component map: auxiliary services (auth, storage, health, …)",
      service: "pipeline wiring, telemetry, extensions enabled",
    };
    return Object.entries(topDetails).map(([k, detail]) => ({
      label: k,
      kind: CompletionItemKind.Module,
      detail,
    }));
  }

  return [];
}

// Build the snippet body for an inserted property. Object/array types expand
// onto a new indented line so the cursor lands ready to fill children; scalars
// stay on one line, optionally pre-filled with the schema's `default`.
//
// Per LSP spec, both `asIs` and `adjustIndentation` insertion modes prepend
// the cursor line's indent to every continuation line — so the snippet body
// only carries the *relative* extra indent (INDENT_UNIT). The client adds
// the cumulative line indent back on top. INDENT_UNIT = 2 spaces, matching
// the editor's YAML indentation convention.
const INDENT_UNIT = "  ";
function snippetForProperty(key: string, schema: JsonSchemaNode): string {
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (t === "object") return `${key}:\n${INDENT_UNIT}$0`;
  if (t === "array") return `${key}:\n${INDENT_UNIT}- $0`;
  if (schema.default !== undefined) {
    const lit =
      typeof schema.default === "string" ? schema.default : JSON.stringify(schema.default);
    return `${key}: \${1:${lit}}`;
  }
  return `${key}: $0`;
}

// If the cursor's line defines a mapping key (`<indent><key>:`), return the
// key — used by the sibling-keys filter to avoid hiding the very key the
// user is currently editing.
function keyOnLine(text: string, line: number): string | null {
  const lines = text.split("\n");
  const src = lines[line] ?? "";
  const m = src.match(/^\s*([A-Za-z_][\w./-]*)\s*:/);
  return m ? m[1]! : null;
}

// Scan backwards from the cursor over identifier characters; the returned
// column is where the typed prefix begins. Used to anchor textEdit.range so
// the replacement covers only the prefix, not the line's leading indent.
function wordStartBefore(text: string, pos: Position): number {
  const lines = text.split("\n");
  const line = lines[pos.line] ?? "";
  let i = Math.min(pos.character, line.length);
  while (i > 0 && /[A-Za-z0-9_]/.test(line[i - 1]!)) i--;
  return i;
}

// Resolve a key path of the form ["receivers","otlp","compression"] to the
// target property schema and, if it has an `enum`, return CompletionItems for
// each value. Returns null when the path doesn't resolve to an enum scalar.
function enumValuesForKeyPath(
  model: SetModel,
  idx: ComponentsIndex,
  keyPath: string[],
): CompletionItem[] | null {
  if (keyPath.length < 3) return null;
  const cls = PARENT_TO_CLASS[keyPath[0]];
  if (!cls) return null;
  const id = keyPath[1];
  const entry = model.components[cls].get(id);
  if (!entry) return null;
  const comp = findComponent(idx, cls, entry.type);
  const baseSchema = (comp?.schema as JsonSchemaNode) ?? { type: "object" };
  const refRoot: JsonSchemaNode = {
    $defs: {
      ...(idx.defs as Record<string, JsonSchemaNode>),
      ...baseSchema.$defs,
    },
  };
  let node: JsonSchemaNode | null = resolveRef(baseSchema, refRoot);
  for (let i = 2; i < keyPath.length && node; i++) {
    node = lookupProperty(node, keyPath[i], refRoot);
  }
  if (!node || !node.enum || !node.enum.length) return null;
  return node.enum.map((v) => {
    const lit = typeof v === "string" ? v : JSON.stringify(v);
    return {
      label: lit,
      kind: CompletionItemKind.EnumMember,
      detail: schemaTypeLabel(node!) || undefined,
    };
  });
}
