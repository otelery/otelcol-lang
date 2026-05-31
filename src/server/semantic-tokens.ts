// Semantic tokens for a config-set member file.
//
// We publish two LSP standard token types:
//   - class      → component ids (receivers/processors/exporters/connectors/extensions)
//                  and references to those ids inside pipelines + extension refs.
//   - namespace  → pipeline ids (the `traces:` / `metrics:` / `traces/acme:` keys
//                  under service.pipelines) and pipeline-id references inside
//                  routing/failover connector configs.
//
// And two modifiers:
//   - declaration  → the definition site of the id (key in the components map
//                    or in service.pipelines).
//   - deprecated   → a component defined in the set but never referenced. Mirrors
//                    the "unused" diagnostic, and renders greyed-out in every
//                    mainstream theme.
//
// The legend order is part of the LSP wire contract — never reorder, only append.

import type { Range } from "vscode-languageserver";
import type { SetModel } from "./set-model";
import type { ComponentClass } from "./components";

export const SEMTOK_TYPES = ["class", "namespace"] as const;
export const SEMTOK_MODIFIERS = ["declaration", "deprecated"] as const;

const T_CLASS = 0;
const T_NAMESPACE = 1;
const M_DECLARATION = 1 << 0;
const M_DEPRECATED = 1 << 1;

export interface SemanticToken {
  line: number;
  char: number;
  len: number;
  type: number;
  mods: number;
}

const CLASSES: ComponentClass[] = ["receiver", "processor", "exporter", "connector", "extension"];

function rangeLen(r: Range): number {
  return r.end.line === r.start.line ? r.end.character - r.start.character : 0;
}

// A component id is "referenced" if any pipeline ref / service.extensions entry
// / extension ref points at it. Connectors count when used as either receiver
// or exporter. Mirrors the logic in pipeline.ts's unused-component detection
// so the deprecated modifier and the diagnostic stay in sync.
function buildReferencedSet(model: SetModel): Record<ComponentClass, Set<string>> {
  const ref: Record<ComponentClass, Set<string>> = {
    receiver: new Set(),
    processor: new Set(),
    exporter: new Set(),
    connector: new Set(),
    extension: new Set(),
  };
  for (const pipe of model.pipelines) {
    for (const r of pipe.receivers) {
      if (model.components.connector.has(r.id)) ref.connector.add(r.id);
      else ref.receiver.add(r.id);
    }
    for (const r of pipe.processors) ref.processor.add(r.id);
    for (const r of pipe.exporters) {
      if (model.components.connector.has(r.id)) ref.connector.add(r.id);
      else ref.exporter.add(r.id);
    }
  }
  for (const r of model.serviceExtensions) ref.extension.add(r.id);
  for (const r of model.extensionRefs) ref.extension.add(r.id);
  return ref;
}

export function computeSemanticTokens(model: SetModel, memberUri: string): SemanticToken[] {
  const member = model.members.get(memberUri);
  if (!member) return [];
  const referenced = buildReferencedSet(model);
  const toks: SemanticToken[] = [];

  // Component definitions in this member.
  for (const cls of CLASSES) {
    for (const entry of member.components[cls].values()) {
      const len = rangeLen(entry.idRange);
      if (len <= 0) continue;
      // Connectors are never flagged as unused — they're always referenced from
      // both sides of the graph by design, and validate-time logic skips them.
      const isUnused = cls !== "connector" && !referenced[cls].has(entry.id);
      const mods = M_DECLARATION | (isUnused ? M_DEPRECATED : 0);
      toks.push({
        line: entry.idRange.start.line,
        char: entry.idRange.start.character,
        len,
        type: T_CLASS,
        mods,
      });
    }
  }

  // Pipeline definitions in this member.
  for (const pipe of member.pipelines) {
    const len = rangeLen(pipe.range);
    if (len <= 0) continue;
    toks.push({
      line: pipe.range.start.line,
      char: pipe.range.start.character,
      len,
      type: T_NAMESPACE,
      mods: M_DECLARATION,
    });
  }

  // Pipeline refs to components (in this member's pipelines).
  for (const pipe of member.pipelines) {
    for (const bucket of ["receivers", "processors", "exporters"] as const) {
      for (const r of pipe[bucket]) {
        const len = rangeLen(r.range);
        if (len <= 0) continue;
        toks.push({
          line: r.range.start.line,
          char: r.range.start.character,
          len,
          type: T_CLASS,
          mods: 0,
        });
      }
    }
  }

  // service.extensions entries — also class refs.
  for (const r of member.serviceExtensions) {
    const len = rangeLen(r.range);
    if (len <= 0) continue;
    toks.push({
      line: r.range.start.line,
      char: r.range.start.character,
      len,
      type: T_CLASS,
      mods: 0,
    });
  }

  // Cross-config extension refs (auth.authenticator, storage, observers, …).
  for (const r of member.extensionRefs) {
    const len = rangeLen(r.range);
    if (len <= 0) continue;
    toks.push({
      line: r.range.start.line,
      char: r.range.start.character,
      len,
      type: T_CLASS,
      mods: 0,
    });
  }

  // Pipeline-id refs inside routing/failover connector configs.
  for (const r of member.pipelineIdRefs) {
    const len = rangeLen(r.range);
    if (len <= 0) continue;
    toks.push({
      line: r.range.start.line,
      char: r.range.start.character,
      len,
      type: T_NAMESPACE,
      mods: 0,
    });
  }

  toks.sort((a, b) => a.line - b.line || a.char - b.char);
  return toks;
}

// Convert raw tokens to the LSP wire format (5 ints per token, position
// delta-encoded against the previous token). First token's deltas are
// absolute. Within the same line, char is relative to the previous token's
// char; on a new line, char is absolute again.
export function encodeSemanticTokens(toks: readonly SemanticToken[]): number[] {
  const out: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const dLine = t.line - prevLine;
    const dChar = dLine === 0 ? t.char - prevChar : t.char;
    out.push(dLine, dChar, t.len, t.type, t.mods);
    prevLine = t.line;
    prevChar = t.char;
  }
  return out;
}
