// Cross-file usage queries against a SetModel. These power three features
// that all need the same data — find-all-references, codelens reference
// counts, and the hover "Used in" line — so they share one implementation.

import type { Location } from "vscode-languageserver";
import type { ComponentClass } from "./components";
import type { SetModel } from "./set-model";

// References to a pipeline id (target of routing/failover connector config).
// Same shape as pipelineRefsTo but the target is a pipeline, not a component.
export function pipelineIdRefsTo(model: SetModel, id: string): Location[] {
  const out: Location[] = [];
  for (const r of model.pipelineIdRefs) {
    if (r.id === id) out.push({ uri: r.sourceUri, range: r.range });
  }
  return out;
}

// Field paths that name where a pipeline id is used (e.g.
// `connectors.routing/by-tenant.table[1].pipelines`).
export function pipelineIdContextsUsing(model: SetModel, id: string, limit = 12): string[] {
  const out = new Set<string>();
  for (const r of model.pipelineIdRefs) {
    if (r.id === id) out.add(r.fieldPath);
  }
  return [...out].slice(0, limit);
}

// All references to (cls, id) across every member of the set:
//  - receivers/processors/exporters/connectors: pipeline refs inside
//    service.pipelines.<sig>.{receivers,processors,exporters}
//  - extensions: entries in service.extensions PLUS any extension ref
//    scraped from component config (auth.authenticator, storage, encoding,
//    watch_observers, additional_auth, oauthbearer_token_source).
// Connectors are matched in both receiver and exporter buckets.
export function pipelineRefsTo(model: SetModel, cls: ComponentClass, id: string): Location[] {
  const out: Location[] = [];
  if (cls === "extension") {
    for (const ref of model.serviceExtensions) {
      if (ref.id === id) out.push({ uri: ref.sourceUri, range: ref.range });
    }
    for (const ref of model.extensionRefs) {
      if (ref.id === id) out.push({ uri: ref.sourceUri, range: ref.range });
    }
    return out;
  }
  for (const pipe of model.pipelines) {
    for (const bucket of ["receivers", "processors", "exporters"] as const) {
      for (const ref of pipe[bucket]) {
        if (ref.id !== id) continue;
        if (cls !== "connector") {
          const refCls: ComponentClass = bucket === "receivers" ? "receiver" : bucket === "processors" ? "processor" : "exporter";
          if (refCls !== cls) continue;
        }
        out.push({ uri: ref.sourceUri, range: ref.range });
      }
    }
  }
  return out;
}

// Distinct context labels naming the places (cls, id) is referenced from,
// capped at `limit`. For pipeline-graph components this is the set of
// pipeline ids; for extensions we list `service.extensions` plus the
// fieldPath of any non-service ref (e.g. `exporters.otlp.auth.authenticator`).
export function pipelinesUsing(model: SetModel, cls: ComponentClass, id: string, limit = 12): string[] {
  if (cls === "extension") {
    const out = new Set<string>();
    if (model.serviceExtensions.some((r) => r.id === id)) out.add("service.extensions");
    for (const r of model.extensionRefs) {
      if (r.id === id) out.add(r.fieldPath);
    }
    return [...out].slice(0, limit);
  }
  const seen = new Set<string>();
  for (const pipe of model.pipelines) {
    for (const bucket of ["receivers", "processors", "exporters"] as const) {
      for (const ref of pipe[bucket]) {
        if (ref.id !== id) continue;
        if (cls !== "connector") {
          const refCls: ComponentClass = bucket === "receivers" ? "receiver" : bucket === "processors" ? "processor" : "exporter";
          if (refCls !== cls) continue;
        }
        seen.add(pipe.id);
      }
    }
  }
  return [...seen].slice(0, limit);
}
