// Pipeline graph validation. Checks:
//   - Each ID referenced in service.pipelines.<sig>.{receivers,processors,exporters}
//     is defined in the corresponding top-level map.
//   - Each referenced component declares support for the pipeline's signal.
//   - Each pipeline has at least one receiver and one exporter.
//   - Reports component definitions that are never referenced (warning).
//   - Reports duplicate component ids across files in a config set.

import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Range } from "vscode-languageserver";
import type { ComponentClass, ComponentsIndex, Signal } from "./components";
import { findComponent } from "./components";
import type { SetModel } from "./set-model";
import { isDuplicate } from "./set-model";

const SIGNAL_MAP: Record<string, Signal> = {
  traces: "traces",
  metrics: "metrics",
  logs: "logs",
  profiles: "profiles",
};

interface BucketSpec {
  bucket: "receivers" | "processors" | "exporters";
  cls: ComponentClass;
}
const BUCKETS: BucketSpec[] = [
  { bucket: "receivers", cls: "receiver" },
  { bucket: "processors", cls: "processor" },
  { bucket: "exporters", cls: "exporter" },
];

export interface SetDiagnostic {
  sourceUri: string;
  diagnostic: Diagnostic;
}

export function validatePipelines(model: SetModel, idx: ComponentsIndex): SetDiagnostic[] {
  const diags: SetDiagnostic[] = [];
  const referenced: Record<ComponentClass, Set<string>> = {
    receiver: new Set(),
    processor: new Set(),
    exporter: new Set(),
    connector: new Set(),
    extension: new Set(),
  };

  for (const pipe of model.pipelines) {
    const signal = SIGNAL_MAP[pipe.signal];
    if (!signal) {
      diags.push(
        emit(
          pipe.sourceUri,
          pipe.range,
          `unknown pipeline signal "${pipe.signal}" (expected traces, metrics, logs, or profiles)`,
          DiagnosticSeverity.Error,
        ),
      );
      continue;
    }
    if (pipe.receivers.length === 0) {
      diags.push(
        emit(
          pipe.sourceUri,
          pipe.range,
          `pipeline ${pipe.id} has no receivers`,
          DiagnosticSeverity.Error,
        ),
      );
    }
    if (pipe.exporters.length === 0) {
      diags.push(
        emit(
          pipe.sourceUri,
          pipe.range,
          `pipeline ${pipe.id} has no exporters`,
          DiagnosticSeverity.Error,
        ),
      );
    }

    for (const { bucket, cls } of BUCKETS) {
      for (const ref of pipe[bucket]) {
        // Ambiguous: id is defined in multiple member files.
        const dupOwn = isDuplicate(model, cls, ref.id);
        const dupConn = isDuplicate(model, "connector", ref.id);
        if (dupOwn || dupConn) {
          const dup = dupOwn ?? dupConn!;
          const where = dup.definitions.map((d) => shortName(d.sourceUri)).join(", ");
          diags.push(
            emit(
              ref.sourceUri,
              ref.range,
              `ambiguous reference "${ref.id}": defined in ${dup.definitions.length} files (${where}); resolve the duplicate before this reference can be used`,
              DiagnosticSeverity.Error,
            ),
          );
          continue;
        }

        // Connectors can act as receivers or exporters; check both maps.
        const inOwn = model.components[cls].has(ref.id);
        const inConn = model.components.connector.has(ref.id);
        if (!inOwn && !inConn) {
          diags.push(
            emit(
              ref.sourceUri,
              ref.range,
              `${cls} "${ref.id}" is not defined`,
              DiagnosticSeverity.Error,
            ),
          );
          continue;
        }
        if (inOwn) referenced[cls].add(ref.id);
        if (inConn) referenced.connector.add(ref.id);

        const entry = inOwn
          ? model.components[cls].get(ref.id)!
          : model.components.connector.get(ref.id)!;
        const resolvedCls = inOwn ? cls : "connector";
        const def = findComponent(idx, resolvedCls, entry.type);
        if (
          def &&
          def.signals.length &&
          !signalMatches(def.signals, signal, bucket, resolvedCls === "connector")
        ) {
          diags.push(
            emit(
              ref.sourceUri,
              ref.range,
              `${cls} "${ref.id}" (type ${entry.type}) does not support ${signal}; supports ${def.signals.join(", ") || "<unknown>"}`,
              DiagnosticSeverity.Warning,
            ),
          );
        }
      }
    }
  }

  // Cross-config extension refs (auth.authenticator, storage, watch_observers,
  // additional_auth). Strict refs error on undefined; soft refs (encoding,
  // oauthbearer_token_source) just mark used when they happen to resolve.
  for (const ref of model.extensionRefs) {
    if (model.components.extension.has(ref.id)) {
      referenced.extension.add(ref.id);
      continue;
    }
    if (isDuplicate(model, "extension", ref.id)) {
      // Duplicate-id pass below already errors on the defining sites; flag the use too.
      diags.push(
        emit(
          ref.sourceUri,
          ref.range,
          `ambiguous reference "${ref.id}" (referenced from ${ref.fieldPath}); resolve the duplicate before this reference can be used`,
          DiagnosticSeverity.Error,
        ),
      );
      continue;
    }
    if (ref.strict) {
      diags.push(
        emit(
          ref.sourceUri,
          ref.range,
          `extension "${ref.id}" is not defined (referenced from ${ref.fieldPath})`,
          DiagnosticSeverity.Error,
        ),
      );
    }
  }

  // Pipeline-id refs from routing/failover-style connectors.
  for (const ref of model.pipelineIdRefs) {
    if (!model.pipelinesById.has(ref.id)) {
      diags.push(
        emit(
          ref.sourceUri,
          ref.range,
          `pipeline "${ref.id}" is not defined (referenced from ${ref.fieldPath})`,
          DiagnosticSeverity.Error,
        ),
      );
    }
  }

  // service.extensions entries: each must resolve to a defined extension;
  // duplicates fall through to the existing duplicate-id pass below.
  for (const ref of model.serviceExtensions) {
    const dup = isDuplicate(model, "extension", ref.id);
    if (dup) {
      const where = dup.definitions.map((d) => shortName(d.sourceUri)).join(", ");
      diags.push(
        emit(
          ref.sourceUri,
          ref.range,
          `ambiguous reference "${ref.id}": defined in ${dup.definitions.length} files (${where}); resolve the duplicate before this reference can be used`,
          DiagnosticSeverity.Error,
        ),
      );
      continue;
    }
    if (!model.components.extension.has(ref.id)) {
      diags.push(
        emit(
          ref.sourceUri,
          ref.range,
          `extension "${ref.id}" is not defined`,
          DiagnosticSeverity.Error,
        ),
      );
      continue;
    }
    referenced.extension.add(ref.id);
  }

  // Duplicate-id errors: one diagnostic per defining site.
  for (const dup of model.duplicates.values()) {
    const where = dup.definitions.map((d) => shortName(d.sourceUri));
    for (let i = 0; i < dup.definitions.length; i++) {
      const def = dup.definitions[i];
      const others = where.filter((_, j) => j !== i).join(", ");
      diags.push(
        emit(
          def.sourceUri,
          def.idRange,
          `duplicate ${dup.cls} id "${dup.id}" (also defined in ${others}); each id must be unique across the config set`,
          DiagnosticSeverity.Error,
        ),
      );
    }
  }

  // Unknown component types and orphan definitions.
  for (const cls of [
    "receiver",
    "processor",
    "exporter",
    "connector",
    "extension",
  ] as ComponentClass[]) {
    for (const [id, entry] of model.components[cls]) {
      // Skip duplicates here — we already errored on them above.
      if (isDuplicate(model, cls, id)) continue;
      const def = findComponent(idx, cls, entry.type);
      if (!def) {
        diags.push(
          emit(
            entry.sourceUri,
            entry.idRange,
            `unknown ${cls} type "${entry.type}"`,
            DiagnosticSeverity.Warning,
          ),
        );
      }
      if (cls !== "connector" && !referenced[cls].has(id)) {
        const where = cls === "extension" ? "service.extensions" : "any pipeline";
        diags.push(
          emit(
            entry.sourceUri,
            entry.idRange,
            `${cls} "${id}" is defined but never used in ${where}`,
            DiagnosticSeverity.Information,
            [DiagnosticTag.Unnecessary],
          ),
        );
      }
    }
  }

  return diags;
}

function emit(
  sourceUri: string,
  range: Range,
  message: string,
  severity: DiagnosticSeverity,
  tags?: DiagnosticTag[],
): SetDiagnostic {
  const diagnostic: Diagnostic = { range, message, severity, source: "otelcol" };
  if (tags && tags.length) diagnostic.tags = tags;
  return { sourceUri, diagnostic };
}

function shortName(uri: string): string {
  const slash = uri.lastIndexOf("/");
  return slash === -1 ? uri : uri.slice(slash + 1);
}

// Connectors declare direction-typed signals like `traces_to_metrics`. When a
// connector is used as a receiver, the signal must match the *right* side
// (`*_to_<signal>`); used as an exporter, the *left* side (`<signal>_to_*`).
// Regular receivers/processors/exporters declare plain signal names.
function signalMatches(
  declared: string[],
  signal: string,
  bucket: "receivers" | "processors" | "exporters",
  isConnector: boolean,
): boolean {
  if (declared.includes(signal)) return true;
  if (!isConnector) return false;
  const needle =
    bucket === "receivers" ? `_to_${signal}` : bucket === "exporters" ? `${signal}_to_` : "";
  if (!needle) return false;
  return declared.some((s) => (bucket === "receivers" ? s.endsWith(needle) : s.startsWith(needle)));
}
