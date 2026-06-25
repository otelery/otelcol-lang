// Combined view of a ConfigSet: each member parsed independently with its own
// DocModel, then unioned. Component ids that appear in more than one member are
// not silently merged — they are recorded as DuplicateEntry and treated as
// undefined for the purposes of pipeline-reference resolution. The user must
// resolve the duplicate before the LSP will accept that id.

import type { Range } from "vscode-languageserver";
import type { ComponentClass } from "./components";
import type {
  ComponentEntry,
  DocModel,
  ExtensionRef,
  OttlBlock,
  PipelineEntry,
  PipelineIdRef,
  PipelineRef,
} from "./yaml-model";
import { buildModel } from "./yaml-model";
import type { ConfigSet } from "./configset";

export interface DuplicateEntry {
  kind: "duplicate";
  cls: ComponentClass;
  id: string;
  definitions: ComponentEntry[];
}

// A pipeline id unioned across every config-set member that declares it. The
// collector deep-merges all `--config` sources, so the effective pipeline is
// the union of the per-file fragments — structural checks (has receivers / has
// exporters) must run on this merged view, not on each fragment in isolation.
// Diagnostics that survive the merge are attributed to the *last* definition
// site (the override the user is most likely editing), matching last-wins.
export interface MergedPipeline {
  id: string;
  signal: string;
  receivers: PipelineRef[];
  processors: PipelineRef[];
  exporters: PipelineRef[];
  lastSourceUri: string;
  lastRange: Range;
}

export interface SetModel {
  set: ConfigSet;
  members: Map<string /* uri */, DocModel>;
  components: Record<ComponentClass, Map<string, ComponentEntry>>;
  duplicates: Map<string /* `${cls}::${id}` */, DuplicateEntry>;
  pipelines: PipelineEntry[];
  pipelinesById: Map<string, PipelineEntry>;
  mergedPipelines: Map<string /* id */, MergedPipeline>;
  serviceExtensions: PipelineRef[];
  extensionRefs: ExtensionRef[];
  pipelineIdRefs: PipelineIdRef[];
  ottlBlocks: OttlBlock[];
}

const CLASSES: ComponentClass[] = ["receiver", "processor", "exporter", "connector", "extension"];

function dupKey(cls: ComponentClass, id: string): string {
  return `${cls}::${id}`;
}

export function buildSetModel(set: ConfigSet, contents: Map<string, string>): SetModel {
  const members = new Map<string, DocModel>();
  for (const uri of set.members) {
    const text = contents.get(uri) ?? "";
    members.set(uri, buildModel(text, uri));
  }

  const components: Record<ComponentClass, Map<string, ComponentEntry>> = {
    receiver: new Map(),
    processor: new Map(),
    exporter: new Map(),
    connector: new Map(),
    extension: new Map(),
  };
  const duplicates = new Map<string, DuplicateEntry>();
  const pipelines: PipelineEntry[] = [];
  const pipelinesById = new Map<string, PipelineEntry>();
  const mergedPipelines = new Map<string, MergedPipeline>();
  const serviceExtensions: PipelineRef[] = [];
  const extensionRefs: ExtensionRef[] = [];
  const pipelineIdRefs: PipelineIdRef[] = [];
  const ottlBlocks: OttlBlock[] = [];

  // Walk members in declared order. First definition wins the slot; later
  // definitions promote the slot into a DuplicateEntry record.
  for (const uri of set.members) {
    const doc = members.get(uri);
    if (!doc) continue;
    for (const cls of CLASSES) {
      for (const [id, entry] of doc.components[cls]) {
        const k = dupKey(cls, id);
        const existing = components[cls].get(id);
        if (!existing) {
          components[cls].set(id, entry);
          continue;
        }
        // Duplicate.
        let rec = duplicates.get(k);
        if (!rec) {
          rec = { kind: "duplicate", cls, id, definitions: [existing] };
          duplicates.set(k, rec);
        }
        rec.definitions.push(entry);
      }
    }
    for (const p of doc.pipelines) {
      pipelines.push(p);
      // Last-wins for duplicate pipeline ids — they're rare and not currently
      // flagged as set-level duplicates; if they become a real concern, hook
      // a `duplicatePipelines` table here.
      pipelinesById.set(p.id, p);
      // Union the fragment into the merged view: concat each section's refs and
      // advance the last-definition site (declared order ⇒ last fragment wins).
      let merged = mergedPipelines.get(p.id);
      if (!merged) {
        merged = {
          id: p.id,
          signal: p.signal,
          receivers: [],
          processors: [],
          exporters: [],
          lastSourceUri: p.sourceUri,
          lastRange: p.range,
        };
        mergedPipelines.set(p.id, merged);
      }
      merged.signal = p.signal;
      merged.lastSourceUri = p.sourceUri;
      merged.lastRange = p.range;
      merged.receivers.push(...p.receivers);
      merged.processors.push(...p.processors);
      merged.exporters.push(...p.exporters);
    }
    for (const e of doc.serviceExtensions) serviceExtensions.push(e);
    for (const r of doc.extensionRefs) extensionRefs.push(r);
    for (const r of doc.pipelineIdRefs) pipelineIdRefs.push(r);
    for (const o of doc.ottlBlocks) ottlBlocks.push(o);
  }

  return {
    set,
    members,
    components,
    duplicates,
    pipelines,
    pipelinesById,
    mergedPipelines,
    serviceExtensions,
    extensionRefs,
    pipelineIdRefs,
    ottlBlocks,
  };
}

export function isDuplicate(
  model: SetModel,
  cls: ComponentClass,
  id: string,
): DuplicateEntry | null {
  return model.duplicates.get(dupKey(cls, id)) ?? null;
}

/**
 * Build a single-doc SetModel for files not belonging to any ConfigSet. The
 * caller still gets one consistent API.
 */
export function singletonSetModel(uri: string, text: string): SetModel {
  const fakeSet: ConfigSet = { anchorUri: uri, dir: "", members: [uri], explicit: null };
  return buildSetModel(fakeSet, new Map([[uri, text]]));
}
