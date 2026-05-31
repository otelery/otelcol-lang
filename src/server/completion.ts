import { CompletionItem, CompletionItemKind, Position } from "vscode-languageserver";
import type { ComponentsIndex, ComponentClass } from "./components";
import { pathAtOffset, offsetFromPos } from "./yaml-model";
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
  const offset = offsetFromPos(doc.text, pos);
  const segs = pathAtOffset(doc.text, offset);

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
    for (const id of model.components[refCls].keys()) {
      ids.push({ label: id, kind: CompletionItemKind.Reference, detail: refCls });
    }
    for (const id of model.components.connector.keys()) {
      ids.push({ label: id, kind: CompletionItemKind.Reference, detail: "connector" });
    }
    return ids;
  }

  // Top-level keys.
  if (segs.length === 0) {
    return ["receivers", "processors", "exporters", "connectors", "extensions", "service"].map(
      (k) => ({
        label: k,
        kind: CompletionItemKind.Module,
      }),
    );
  }

  return [];
}
