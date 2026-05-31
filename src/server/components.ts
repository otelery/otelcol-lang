import * as fs from "node:fs";
import * as path from "node:path";

export type ComponentClass = "receiver" | "processor" | "exporter" | "connector" | "extension";
export type Signal = "traces" | "metrics" | "logs" | "profiles";

export interface Component {
  class: ComponentClass;
  type: string;
  displayName: string;
  dirName: string;
  signals: Signal[];
  stability: Record<string, Signal[]>;
  distributions: string[];
  description: string;
  schema: unknown;
  /** Full parsed `metadata.yaml`. Includes codeowners, warnings, feature_gates,
   *  resource_attributes, telemetry config — anything upstream chooses to ship. */
  metadata?: ComponentMetadata;
  /** "static" when the schema comes from `schemas/static/`, undefined when from contrib. */
  schemaSource?: "static";
  /** True when this entry was published only under a `deprecated_type` alias. */
  deprecated?: boolean;
}

export interface ComponentMetadata {
  type?: string;
  display_name?: string;
  deprecated_type?: string;
  status?: {
    class?: ComponentClass;
    stability?: Record<string, Signal[]>;
    distributions?: string[];
    warnings?: string[];
    codeowners?: {
      active?: string[];
      emeritus?: string[];
      seeking_new?: boolean;
    };
  };
  feature_gates?: Array<{
    id: string;
    description?: string;
    stage?: string;
    from_version?: string;
    reference_url?: string;
  }>;
  resource_attributes?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  telemetry?: unknown;
  // Anything else upstream stores.
  [k: string]: unknown;
}

export interface ComponentsIndex {
  generatedAt: string;
  contribPath: string;
  components: Record<ComponentClass, Component[]>;
  /** Global `$defs` from the per-distribution JSON Schema. Used as the
   *  ref-resolution root by hover. Empty when the per-distribution JSON
   *  Schema is not present (e.g. the build pipeline didn't run). */
  defs: Record<string, unknown>;
}

// Distribution-aware loader. Reads two files per distribution:
//
//   schemas/distributions/<slug>-<version>.json     component metadata index
//   schemas/json/<slug>-config-<version>.json       per-distribution JSON Schema
//                                                    (with all $refs canonicalised
//                                                    and a global $defs block)
//
// Component schemas come from the JSON Schema's patternProperties — they
// already have refs in `#/$defs/...` form, so hover can walk them with the
// same shared $defs root.
//
// The "distribution" parameter follows the slugs in schemas/distributions.yaml
// (otelcol, otelcol-contrib, otelcol-k8s, datadog-otelcol, elastic-otelcol, …).
// If multiple versions exist, the highest is used.

const cache = new Map<string, ComponentsIndex>();

function resolveSchemasBase(searchFrom: string, sub: string): string | null {
  const candidates = [
    path.join(searchFrom, "schemas", sub),
    path.join(searchFrom, "..", "schemas", sub),
    path.join(searchFrom, "..", "..", "schemas", sub),
    path.join(searchFrom, "..", "..", "..", "schemas", sub),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

export function listDistributions(searchFrom: string): { slug: string; version: string }[] {
  const base = resolveSchemasBase(searchFrom, "distributions");
  if (!base) return [];
  return fs
    .readdirSync(base)
    .map((f) => /^(.+)-(\d[^.]*(?:\.[^.]+)*)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ slug: m[1], version: m[2] }));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CLASS_TO_BUCKET: Record<ComponentClass, string> = {
  receiver: "receivers",
  processor: "processors",
  exporter: "exporters",
  connector: "connectors",
  extension: "extensions",
};

export function loadComponents(
  searchFrom: string,
  distribution = "otelcol-contrib",
): ComponentsIndex {
  if (cache.has(distribution)) return cache.get(distribution)!;
  const base = resolveSchemasBase(searchFrom, "distributions");
  if (!base) {
    return cacheAndReturn(distribution, emptyIndex());
  }
  // Pick the highest-version file matching the slug.
  const matches = fs
    .readdirSync(base)
    .map((f) => {
      const m = new RegExp(`^${escapeRegex(distribution)}-(\\d[^.]*(?:\\.[^.]+)*)\\.json$`).exec(f);
      return m ? { f, version: m[1] } : null;
    })
    .filter((x): x is { f: string; version: string } => !!x)
    .sort((a, b) => (a.version < b.version ? 1 : -1));
  if (!matches.length) {
    if (distribution !== "otelcol-contrib") return loadComponents(searchFrom, "otelcol-contrib");
    return cacheAndReturn(distribution, emptyIndex());
  }
  const raw = JSON.parse(fs.readFileSync(path.join(base, matches[0].f), "utf8"));

  // Pull the resolved per-distribution JSON Schema for this slug + version.
  // build-schemas.mjs writes `<slug>-config-<version>.json` next to its peers.
  const jsonBase = resolveSchemasBase(searchFrom, "json");
  const jsonSchemaFile = jsonBase
    ? path.join(jsonBase, `${distribution}-config-${matches[0].version}.json`)
    : null;
  let resolvedRoot: any = null;
  if (jsonSchemaFile && fs.existsSync(jsonSchemaFile)) {
    try {
      resolvedRoot = JSON.parse(fs.readFileSync(jsonSchemaFile, "utf8"));
    } catch {
      // Leave resolvedRoot null — we fall back to the per-component upstream
      // schema, which still has unresolved refs but at least surfaces the
      // top-level field descriptions.
    }
  }

  const reshaped: ComponentsIndex = {
    generatedAt: raw.generatedAt ?? "",
    contribPath: raw.manifest ?? "",
    components: { receiver: [], processor: [], exporter: [], connector: [], extension: [] },
    defs: (resolvedRoot?.$defs as Record<string, unknown>) ?? {},
  };

  for (const c of raw.components ?? []) {
    const cls = c.class as ComponentClass;
    const arr = reshaped.components[cls];
    if (!arr) continue;
    const resolvedSchema = lookupResolvedSchema(resolvedRoot, cls, c.type);
    arr.push({
      class: cls,
      type: c.type,
      displayName: c.displayName,
      dirName: c.modulePath,
      signals: c.signals ?? [],
      stability: c.stability ?? {},
      distributions: [raw.slug],
      description: c.description ?? "",
      schema: resolvedSchema ?? c.schema ?? null,
      metadata: c.metadata,
      schemaSource: c.source === "static" ? "static" : undefined,
    });
  }
  return cacheAndReturn(distribution, reshaped);
}

// Pluck the resolved component schema out of the per-distribution JSON Schema.
// Returns null when the schema isn't present (e.g. core-only distros without
// patternProperties for that class).
function lookupResolvedSchema(root: any, cls: ComponentClass, type: string): unknown {
  if (!root) return null;
  const bucket = root.properties?.[CLASS_TO_BUCKET[cls]];
  const patternProps = bucket?.patternProperties;
  if (!patternProps) return null;
  const pattern = `^${escapeRegex(type)}(/.+)?$`;
  return patternProps[pattern] ?? null;
}

function cacheAndReturn(key: string, idx: ComponentsIndex): ComponentsIndex {
  cache.set(key, idx);
  return idx;
}

function emptyIndex(): ComponentsIndex {
  return {
    generatedAt: "",
    contribPath: "",
    components: { receiver: [], processor: [], exporter: [], connector: [], extension: [] },
    defs: {},
  };
}

// A collector component ID is "type" or "type/name".
export function splitComponentId(id: string): { type: string; name?: string } {
  const slash = id.indexOf("/");
  if (slash === -1) return { type: id };
  return { type: id.slice(0, slash), name: id.slice(slash + 1) };
}

export function findComponent(
  idx: ComponentsIndex,
  cls: ComponentClass,
  type: string,
): Component | undefined {
  return idx.components[cls]?.find((c) => c.type === type);
}
