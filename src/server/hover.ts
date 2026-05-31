import { Hover, MarkupKind, Position, Range } from "vscode-languageserver";
import { isMap, isSeq, isPair, isScalar, Node } from "yaml";
import type { ComponentsIndex, Component, ComponentClass } from "./components";
import { findComponent } from "./components";
import { rangeFromOffsets } from "./yaml-model";
import type { SetModel } from "./set-model";
import { pipelinesUsing } from "./usage";

const CLASSES: ComponentClass[] = ["receiver", "processor", "exporter", "connector", "extension"];

export function hover(model: SetModel, uri: string, idx: ComponentsIndex, pos: Position): Hover | null {
  const doc = model.members.get(uri);
  if (!doc) return null;

  // 1. Hover on a key inside a component's config block (this file's components only;
  //    config-block walking needs the originating doc's text + AST).
  for (const cls of CLASSES) {
    for (const entry of doc.components[cls].values()) {
      if (!entry.configNode || !containsPos(entry.configRange, pos)) continue;
      const comp = findComponent(idx, cls, entry.type);
      const schema = (comp?.schema as JsonSchemaNode) ?? { type: "object" };
      const refRoot: JsonSchemaNode = {
        $defs: {
          ...(idx.defs as Record<string, JsonSchemaNode>),
          ...(schema.$defs ?? {}),
        },
      };
      const keyHover = walkConfigForKey(doc.text, entry.configNode, schema, pos, refRoot);
      if (keyHover) return keyHover;
    }
  }

  // 2. Component-ID hover anywhere in this file.
  for (const cls of CLASSES) {
    for (const entry of doc.components[cls].values()) {
      if (containsPos(entry.idRange, pos)) {
        const comp = findComponent(idx, cls, entry.type);
        const usedIn = pipelinesUsing(model, cls, entry.id);
        return formatComponentHover(cls, entry.type, comp, entry.idRange, usedIn);
      }
    }
  }
  // 3. Pipeline references in this file → resolve to component definitions across the set.
  for (const pipe of doc.pipelines) {
    for (const bucket of ["receivers", "processors", "exporters"] as const) {
      for (const ref of pipe[bucket]) {
        if (!containsPos(ref.range, pos)) continue;
        const cls: ComponentClass = bucket === "receivers" ? "receiver" : bucket === "processors" ? "processor" : "exporter";
        const entry = model.components[cls].get(ref.id) ?? model.components.connector.get(ref.id);
        if (!entry) return null;
        const realCls = model.components[cls].has(ref.id) ? cls : "connector";
        const comp = findComponent(idx, realCls, entry.type);
        const usedIn = pipelinesUsing(model, realCls, ref.id);
        return formatComponentHover(realCls, entry.type, comp, ref.range, usedIn);
      }
    }
  }
  // 4. service.extensions references → resolve to extension definitions.
  for (const ref of doc.serviceExtensions) {
    if (!containsPos(ref.range, pos)) continue;
    const entry = model.components.extension.get(ref.id);
    if (!entry) return null;
    const comp = findComponent(idx, "extension", entry.type);
    const usedIn = pipelinesUsing(model, "extension", ref.id);
    return formatComponentHover("extension", entry.type, comp, ref.range, usedIn);
  }
  // 5. Cross-config extension refs (auth.authenticator, storage, encoding, watch_observers, …).
  for (const ref of doc.extensionRefs) {
    if (!containsPos(ref.range, pos)) continue;
    const entry = model.components.extension.get(ref.id);
    if (!entry) return null;
    const comp = findComponent(idx, "extension", entry.type);
    const usedIn = pipelinesUsing(model, "extension", ref.id);
    return formatComponentHover("extension", entry.type, comp, ref.range, usedIn);
  }
  return null;
}

// --- per-key hover -----------------------------------------------------

interface JsonSchemaNode {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  patternProperties?: Record<string, JsonSchemaNode>;
  additionalProperties?: boolean | JsonSchemaNode;
  items?: JsonSchemaNode;
  $ref?: string;
  $defs?: Record<string, JsonSchemaNode>;
  // contrib schemas use top-level $defs too
  definitions?: Record<string, JsonSchemaNode>;
  allOf?: JsonSchemaNode[];
  enum?: unknown[];
  default?: unknown;
  format?: string;
  required?: string[];
}

function walkConfigForKey(
  text: string,
  node: Node,
  schema: JsonSchemaNode | null,
  pos: Position,
  refRoot: JsonSchemaNode,
): Hover | null {
  const componentSchema = schema ? resolveRef(schema, refRoot) : null;
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      const keyName = String(pair.key.value);
      const keyRange = nodeRange(text, pair.key as Node);
      const value = pair.value as Node | null;

      const componentProp = componentSchema
        ? lookupProperty(componentSchema, keyName, refRoot)
        : null;

      if (containsPos(keyRange, pos)) {
        if (!componentProp) return null;
        return formatKeyHover(keyName, componentProp, keyRange);
      }
      if (value) {
        const valueRange = nodeRange(text, value);
        if (containsPos(valueRange, pos)) {
          return walkConfigForKey(text, value, componentProp, pos, refRoot);
        }
      }
    }
  } else if (isSeq(node)) {
    const componentItem = componentSchema?.items ? resolveRef(componentSchema.items, refRoot) : null;
    for (const item of node.items) {
      const r = nodeRange(text, item as Node);
      if (containsPos(r, pos)) return walkConfigForKey(text, item as Node, componentItem, pos, refRoot);
    }
  }
  return null;
}

function lookupProperty(schema: JsonSchemaNode, key: string, root: JsonSchemaNode): JsonSchemaNode | null {
  const resolved = resolveRef(schema, root);
  const direct = resolved.properties?.[key];
  if (direct) return resolveRef(direct, root);
  // allOf-merged schemas: walk each branch and return the first hit.
  if (resolved.allOf) {
    for (const branch of resolved.allOf) {
      const hit = lookupProperty(resolveRef(branch, root), key, root);
      if (hit) return hit;
    }
  }
  if (resolved.patternProperties) {
    for (const [pat, sub] of Object.entries(resolved.patternProperties)) {
      try {
        if (new RegExp(pat).test(key)) return resolveRef(sub, root);
      } catch {
        // ignore invalid pattern
      }
    }
  }
  if (typeof resolved.additionalProperties === "object" && resolved.additionalProperties !== null) {
    return resolveRef(resolved.additionalProperties as JsonSchemaNode, root);
  }
  return null;
}

// Resolve a $ref. Supports:
//   - JSON-Pointer:  "#/$defs/foo"  or  "#/definitions/foo"
//   - bare key:      "foo"  → root.$defs.foo  (legacy upstream form)
//   - anything else  → returned as-is so the caller can still surface the
//                      field's own description.
function resolveRef(schema: JsonSchemaNode, root: JsonSchemaNode, depth = 0): JsonSchemaNode {
  if (depth > 16) return schema;
  if (!schema?.$ref) return schema;
  const ref = schema.$ref;
  let target: JsonSchemaNode | undefined;
  if (ref.startsWith("#/$defs/")) target = root.$defs?.[ref.slice(8)];
  else if (ref.startsWith("#/definitions/")) target = root.definitions?.[ref.slice(14)];
  else if (!ref.startsWith("/") && !ref.startsWith("#") && !ref.includes("://")) {
    target = root.$defs?.[ref] ?? root.definitions?.[ref];
  }
  if (!target) return schema;
  // Merge sibling keys (e.g. description) with the resolved target.
  const { $ref: _drop, ...rest } = schema;
  return resolveRef({ ...target, ...rest }, root, depth + 1);
}

function formatKeyHover(key: string, schema: JsonSchemaNode, range: Range): Hover {
  const resolved = schema;
  const lines: string[] = [];
  const typeStr = Array.isArray(resolved.type) ? resolved.type.join(" \\| ") : resolved.type ?? "";
  lines.push(`**\`${key}\`**${typeStr ? ` — *${typeStr}${resolved.format ? `, ${resolved.format}` : ""}*` : ""}`);
  if (resolved.description) lines.push("", resolved.description);
  if (resolved.enum && resolved.enum.length) {
    lines.push("", `*Allowed*: ${resolved.enum.map((e) => `\`${String(e)}\``).join(", ")}`);
  }
  if (resolved.default !== undefined) {
    lines.push(`*Default*: \`${JSON.stringify(resolved.default)}\``);
  }
  return { range, contents: { kind: MarkupKind.Markdown, value: lines.join("\n") } };
}

function nodeRange(text: string, node: Node | null): Range {
  if (!node || !(node as any).range) return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const [start, valueEnd] = (node as any).range as [number, number, number];
  return rangeFromOffsets(text, start, valueEnd);
}

// --- component hover (unchanged) ---------------------------------------

function formatComponentHover(cls: ComponentClass, type: string, comp: Component | undefined, range: Range, usedIn: string[] = []): Hover {
  const lines: string[] = [];
  lines.push(`**${cls}**: \`${type}\`${comp ? ` — ${comp.displayName}` : ""}`);
  if (usedIn.length) {
    lines.push(`*Used in*: ${usedIn.map((p) => `\`${p}\``).join(", ")}`);
  } else if (cls === "extension") {
    lines.push(`*Used in*: _(not listed in service.extensions)_`);
  } else if (cls !== "connector") {
    lines.push(`*Used in*: _(not referenced by any pipeline)_`);
  }
  if (comp) {
    if (comp.signals.length) lines.push(`*Signals*: ${comp.signals.join(", ")}`);
    if (comp.distributions.length) lines.push(`*Distributions*: ${comp.distributions.join(", ")}`);
    const stab = stabilitySummary(comp);
    if (stab) lines.push(`*Stability*: ${stab}`);

    const warnings = comp.metadata?.status?.warnings;
    if (warnings && warnings.length) {
      lines.push(`⚠ *Warnings*: ${warnings.join(", ")}`);
    }

    const co = comp.metadata?.status?.codeowners;
    if (co?.active?.length) {
      const owners = co.active.map((u) => `@${u}`).join(", ");
      const seeking = co.seeking_new ? " — seeking more" : "";
      lines.push(`*Codeowners*: ${owners}${seeking}`);
    }

    const gates = comp.metadata?.feature_gates;
    if (gates && gates.length) {
      const items = gates.map((g) => `- \`${g.id}\` (${g.stage ?? "?"}${g.from_version ? `, from ${g.from_version}` : ""})${g.description ? ` — ${g.description}` : ""}`);
      lines.push(`*Feature gates*:\n${items.join("\n")}`);
    }

    if (comp.description) lines.push("", comp.description);
    if (comp.schemaSource === "static") lines.push("", "_Schema is locally maintained — not yet generated upstream._");
  } else {
    lines.push("", "_No metadata for this component in the bundled contrib index._");
  }
  return {
    range,
    contents: { kind: MarkupKind.Markdown, value: lines.join("\n\n") },
  };
}

function stabilitySummary(c: Component): string {
  const parts: string[] = [];
  for (const [level, signals] of Object.entries(c.stability)) {
    if (Array.isArray(signals) && signals.length) parts.push(`${level}: ${signals.join("/")}`);
  }
  return parts.join("; ");
}

function containsPos(range: Range, pos: Position): boolean {
  if (pos.line < range.start.line || pos.line > range.end.line) return false;
  if (pos.line === range.start.line && pos.character < range.start.character) return false;
  if (pos.line === range.end.line && pos.character > range.end.character) return false;
  return true;
}
