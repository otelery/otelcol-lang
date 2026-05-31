// otelcol-lsp — Language Server for OpenTelemetry Collector configs.
//
// Capabilities:
//   - diagnostics: YAML parse errors, pipeline graph validation (component
//     refs exist, signal compatibility), unused / unknown components.
//   - hover: component metadata (signals, stability, description from the
//     bundled contrib index).
//   - completion: component types inside receivers/processors/exporters/
//     connectors/extensions; defined IDs inside pipeline buckets.
//   - embedded OTTL diagnostics forwarded to ottl-lsp when available.
//   - cross-file analysis: discovers config sets anchored on
//     `service.pipelines:`, then validates and resolves references across
//     all member files (so a pipeline in pipelines.yaml can reference a
//     receiver defined in base.yaml).

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic,
  Location,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "node:fs";
import * as path from "node:path";

import { loadComponents } from "./components";
import { validatePipelines } from "./pipeline";
import { hover as computeHover } from "./hover";
import { completion as computeCompletion } from "./completion";
import { OttlForwarder } from "./ottl-forward";
import { ConfigSetIndex, fsToUri, uriToFs, type ConfigSet } from "./configset";
import { buildSetModel, singletonSetModel, isDuplicate, type SetModel } from "./set-model";
import { pipelineRefsTo, pipelineIdRefsTo } from "./usage";
import {
  computeSemanticTokens,
  encodeSemanticTokens,
  SEMTOK_MODIFIERS,
  SEMTOK_TYPES,
} from "./semantic-tokens";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let componentsIndex = loadComponents(__dirname);
let workspaceRoots: string[] = [];
let settings = {
  contribPath: "",
  ottlLspPath: "",
  distribution: "otelcol-contrib",
  autoDiscover: true,
  maxFilesScanned: 2000,
};
let ottl: OttlForwarder | null = null;
const configSetIndex = new ConfigSetIndex({ autoDiscover: true, maxFilesScanned: 2000 });

// Cache: anchorUri -> { model, fingerprint } where fingerprint = JSON of (uri, version/mtime) per member.
const setModelCache = new Map<string, { model: SetModel; fingerprint: string }>();

// Track which member URIs we've previously published diagnostics for, so we
// can send empty arrays to clear stale squiggles when a file leaves a set.
const publishedFor = new Set<string>();

// Disk-read cache for unopened member files.
const diskCache = new Map<string, { mtimeMs: number; text: string }>();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoots = (params.workspaceFolders ?? [])
    .map((f) => f.uri)
    .filter((u) => u.startsWith("file://"))
    .map((u) => uriToFs(u));
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      completionProvider: { triggerCharacters: [":", " ", "\n", "-"] },
      definitionProvider: true,
      referencesProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes: [...SEMTOK_TYPES],
          tokenModifiers: [...SEMTOK_MODIFIERS],
        },
        range: false,
        full: { delta: false },
      },
    },
  };
});

connection.onInitialized(async () => {
  try {
    const cfg = await connection.workspace.getConfiguration("otelcol");
    applySettings(cfg);
  } catch {
    // No client config — keep defaults.
  }
  configSetIndex.setRoots(workspaceRoots);
  configSetIndex.setOptions({
    autoDiscover: settings.autoDiscover,
    maxFilesScanned: settings.maxFilesScanned,
  });
  configSetIndex.rescan();
  connection.console.info(
    `otelcol-lsp: indexed ${countComponents()} components from ${componentsIndex.contribPath || "<bundled>"}; ` +
      `${configSetIndex.allSets().length} config set(s)`,
  );
  for (const doc of documents.all()) ensureRootFor(doc.uri);
  validateAllSets();
  for (const doc of documents.all()) validate(doc);
});

connection.onDidChangeConfiguration(async (params) => {
  const cfg = params.settings?.otelcol ?? (await connection.workspace.getConfiguration("otelcol"));
  applySettings(cfg);
  configSetIndex.setOptions({
    autoDiscover: settings.autoDiscover,
    maxFilesScanned: settings.maxFilesScanned,
  });
  configSetIndex.rescan();
  setModelCache.clear();
  validateAllSets();
  for (const doc of documents.all()) validate(doc);
});

function applySettings(cfg: any) {
  const newDistribution = cfg?.distribution ?? "otelcol-contrib";
  settings = {
    contribPath: cfg?.contribPath ?? "",
    ottlLspPath: cfg?.ottlLspPath ?? "",
    distribution: newDistribution,
    autoDiscover: cfg?.configSets?.autoDiscover ?? true,
    maxFilesScanned: cfg?.configSets?.maxFilesScanned ?? 2000,
  };
  if (newDistribution) {
    componentsIndex = loadComponents(__dirname, newDistribution);
    connection.console.info(
      `otelcol-lsp: distribution=${newDistribution}, ${countComponents()} components`,
    );
  }
  ottl?.stop();
  ottl = null;
  if (settings.ottlLspPath) {
    const f = new OttlForwarder(settings.ottlLspPath);
    if (f.start()) ottl = f;
  }
}

function countComponents() {
  return Object.values(componentsIndex.components).reduce((n, arr) => n + arr.length, 0);
}

// Debounce validation runs per anchor. Hover/completion/definition build the
// SetModel synchronously and are independent of validate, so typing latency
// is bounded by the cache, not the validator.
const validateTimers = new Map<string, NodeJS.Timeout>();
const VALIDATE_DEBOUNCE_MS = 150;

documents.onDidChangeContent((e) => {
  invalidateSetFor(e.document.uri);
  scheduleValidate(e.document.uri);
});
documents.onDidOpen((e) => {
  ensureRootFor(e.document.uri);
  validate(e.document);
});

// When the client opens a file outside any known workspace root, fall back to
// using the file's enclosing directory (walking up to the nearest dir that
// contains a sidecar or an anchor-shaped yaml) as a discovery root. Triggers
// a rescan + proactive validate so cross-file resolution works without a
// formal workspace folder.
function ensureRootFor(uri: string): void {
  if (!uri.startsWith("file://")) return;
  const fsPath = uriToFs(uri);
  if (workspaceRoots.some((r) => isAncestorOrSelf(r, fsPath))) return;
  const root = findDiscoveryRoot(fsPath) ?? path.dirname(fsPath);
  if (workspaceRoots.includes(root)) return;
  workspaceRoots = [...workspaceRoots, root];
  configSetIndex.setRoots(workspaceRoots);
  configSetIndex.rescan();
  setModelCache.clear();
  validateAllSets();
}

function isAncestorOrSelf(ancestor: string, target: string): boolean {
  const rel = path.relative(ancestor, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Walk upward from a file's directory looking for the topmost directory that
// still has either a sidecar or an anchor-shaped yaml. Caps at the filesystem
// root or six levels up — beyond that the heuristic isn't worth the IO.
function findDiscoveryRoot(fsPath: string): string | null {
  let dir = path.dirname(fsPath);
  let best: string | null = null;
  for (let i = 0; i < 6; i++) {
    if (dirContainsSidecarOrAnchor(dir)) best = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return best;
}

function dirContainsSidecarOrAnchor(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name === "otelcol-configset.yaml") return true;
      if (!/\.ya?ml$/i.test(e.name)) continue;
      try {
        const fd = fs.openSync(path.join(dir, e.name), "r");
        try {
          const buf = Buffer.alloc(4096);
          const n = fs.readSync(fd, buf, 0, 4096, 0);
          const head = buf.toString("utf8", 0, n);
          if (/^service:\s*$/m.test(head) && /^[ \t]+pipelines:/m.test(head)) return true;
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        /* ignore unreadable */
      }
    }
  } catch {
    /* ignore unreadable dir */
  }
  return false;
}

// Build SetModel for every discovered set and publish diagnostics to every
// member URI. This makes diagnostics appear on a fragment even when only the
// anchor has been opened (or vice versa).
function validateAllSets(): void {
  for (const set of configSetIndex.allSets()) {
    void validateSet(set);
  }
}

async function validateSet(set: ConfigSet): Promise<void> {
  // Pick any open member to drive the validate(); if none is open, fabricate
  // a TextDocument-ish from disk for the anchor.
  for (const memberUri of set.members) {
    const open = documents.get(memberUri);
    if (open) {
      await validate(open);
      return;
    }
  }
  // No open members — build, run validation, publish for all member URIs from disk text.
  const model = buildOrReuseSetModel(set);
  const allBuckets = new Map<string, Diagnostic[]>();
  for (const uri of model.members.keys()) allBuckets.set(uri, []);
  for (const [uri, dm] of model.members) {
    for (const d of dm.diagnostics) {
      allBuckets
        .get(uri)!
        .push({ range: d.range, message: d.message, severity: 1, source: "otelcol" });
    }
  }
  for (const sd of validatePipelines(model, componentsIndex)) {
    let arr = allBuckets.get(sd.sourceUri);
    if (!arr) {
      arr = [];
      allBuckets.set(sd.sourceUri, arr);
    }
    arr.push(sd.diagnostic);
  }
  for (const [uri, diags] of allBuckets) {
    connection.sendDiagnostics({ uri, diagnostics: diags });
    publishedFor.add(uri);
  }
}

function scheduleValidate(triggerUri: string) {
  const set = configSetIndex.getSetForUri(triggerUri);
  const key = set ? set.anchorUri : triggerUri;
  const existing = validateTimers.get(key);
  if (existing) clearTimeout(existing);
  validateTimers.set(
    key,
    setTimeout(() => {
      validateTimers.delete(key);
      void validateMembersOfSetContaining(triggerUri);
    }, VALIDATE_DEBOUNCE_MS),
  );
}

connection.onDidChangeWatchedFiles((params) => {
  let rescanNeeded = false;
  for (const ch of params.changes) {
    const uri = ch.uri;
    // Treat any create/delete as possibly changing anchor topology.
    if (ch.type === 1 /* Created */ || ch.type === 3 /* Deleted */) {
      rescanNeeded = true;
    }
    // Drop disk cache so the next read picks up changes.
    diskCache.delete(uri);
    // If the file is a sidecar, rescan (set membership changes).
    if (uri.endsWith("/otelcol-configset.yaml")) rescanNeeded = true;
    // Invalidate any set containing this URI.
    const set = configSetIndex.getSetForUri(uri);
    if (set) setModelCache.delete(set.anchorUri);
  }
  if (rescanNeeded) {
    configSetIndex.rescan();
    setModelCache.clear();
    validateAllSets();
  }
  // Revalidate open docs (cheap; uses cached models where possible).
  for (const doc of documents.all()) validate(doc);
});

function invalidateSetFor(uri: string) {
  const set = configSetIndex.getSetForUri(uri);
  if (set) setModelCache.delete(set.anchorUri);
}

async function validateMembersOfSetContaining(uri: string): Promise<void> {
  const set = configSetIndex.getSetForUri(uri);
  if (!set) {
    const open = documents.get(uri);
    if (open) await validate(open);
    return;
  }
  // One validate call publishes diagnostics for every member of the set
  // (the per-URI bucketing inside validate handles that). Any open member
  // will do; if none, skip.
  for (const memberUri of set.members) {
    const open = documents.get(memberUri);
    if (open) {
      await validate(open);
      return;
    }
  }
}

async function validate(doc: TextDocument): Promise<void> {
  const uri = doc.uri;
  const set = configSetIndex.getSetForUri(uri);
  const model = set ? buildOrReuseSetModel(set) : singletonSetModel(uri, doc.getText());

  const allBuckets = new Map<string, Diagnostic[]>();
  const touch = (memberUri: string) => {
    let arr = allBuckets.get(memberUri);
    if (!arr) {
      arr = [];
      allBuckets.set(memberUri, arr);
    }
    return arr;
  };

  // Always create a bucket for every member so empty arrays clear stale diagnostics.
  for (const memberUri of model.members.keys()) touch(memberUri);

  // YAML parse diagnostics, per file.
  for (const [memberUri, dm] of model.members) {
    for (const d of dm.diagnostics) {
      touch(memberUri).push({
        range: d.range,
        message: d.message,
        severity: 1, // Error
        source: "otelcol",
      });
    }
  }

  // Pipeline / cross-file validation.
  for (const sd of validatePipelines(model, componentsIndex)) {
    touch(sd.sourceUri).push(sd.diagnostic);
  }

  // OTTL forwarder diagnostics — attributed by sourceUri.
  if (ottl) {
    try {
      const results = await ottl.diagnose(model.ottlBlocks);
      for (const r of results) touch(r.sourceUri).push(r.diagnostic);
    } catch (e) {
      connection.console.warn(`ottl forward failed: ${(e as Error).message}`);
    }
  }

  // Publish per-URI; include previously-published URIs that no longer belong to this set
  // so their squiggles get cleared (only when we have authority — i.e. the previously
  // published URI maps to the same anchor, or the user just left the set).
  for (const [memberUri, diags] of allBuckets) {
    connection.sendDiagnostics({ uri: memberUri, diagnostics: diags });
    publishedFor.add(memberUri);
  }
}

// Returns the cached SetModel if present, otherwise builds and caches it.
// No fingerprint / no stat: cache invalidation is purely event-driven via
// documents.onDidChangeContent (open files) and onDidChangeWatchedFiles
// (closed files). This keeps hover/completion/definition under ~1ms once
// warm.
function buildOrReuseSetModel(set: ConfigSet): SetModel {
  const cached = setModelCache.get(set.anchorUri);
  if (cached) return cached.model;

  const contents = new Map<string, string>();
  for (const uri of set.members) {
    const open = documents.get(uri);
    contents.set(uri, open ? open.getText() : readDisk(uri));
  }
  const model = buildSetModel(set, contents);
  setModelCache.set(set.anchorUri, { model, fingerprint: "" });
  return model;
}

// Disk-read cache for unopened member files. Population is lazy on first
// read; invalidation is exclusively driven by onDidChangeWatchedFiles. We
// never re-stat on the hot path.
function readDisk(uri: string): string {
  const cached = diskCache.get(uri);
  if (cached) return cached.text;
  let text = "";
  let mtimeMs = 0;
  try {
    const p = uriToFs(uri);
    text = fs.readFileSync(p, "utf8");
    mtimeMs = fs.statSync(p).mtimeMs;
  } catch {
    /* unreadable */
  }
  diskCache.set(uri, { mtimeMs, text });
  return text;
}

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const set = configSetIndex.getSetForUri(doc.uri);
  const model = set ? buildOrReuseSetModel(set) : singletonSetModel(doc.uri, doc.getText());
  return computeHover(model, doc.uri, componentsIndex, params.position);
});

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const set = configSetIndex.getSetForUri(doc.uri);
  const model = set ? buildOrReuseSetModel(set) : singletonSetModel(doc.uri, doc.getText());
  return computeCompletion(model, doc.uri, componentsIndex, params.position);
});

// Go-to-definition: jump from a pipeline ID reference to the component definition.
// Cross-file aware: returns the URI of the file that actually defines the id.
// For ambiguous (duplicate) ids, returns all definition locations.
//
// We return LocationLink (not plain Location) with an explicit
// originSelectionRange covering the full `type/name` token. Without this, VS
// Code uses the language's word pattern to determine what's clickable — and
// `/` is a word separator by default, so only `otlp` or `primary` would
// register as the hover-link target. The originSelectionRange makes the
// entire `otlp/primary` ref a single hyperlink.
connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const set = configSetIndex.getSetForUri(doc.uri);
  const model = set ? buildOrReuseSetModel(set) : singletonSetModel(doc.uri, doc.getText());
  const member = model.members.get(doc.uri);
  if (!member) return null;
  const pos = params.position;
  for (const pipe of member.pipelines) {
    for (const bucket of ["receivers", "processors", "exporters"] as const) {
      for (const ref of pipe[bucket]) {
        if (!inRange(ref.range, pos)) continue;
        const cls =
          bucket === "receivers" ? "receiver" : bucket === "processors" ? "processor" : "exporter";

        const dupOwn = isDuplicate(model, cls, ref.id);
        const dupConn = isDuplicate(model, "connector", ref.id);
        if (dupOwn || dupConn) {
          const dup = dupOwn ?? dupConn!;
          return dup.definitions.map((d) => ({
            originSelectionRange: ref.range,
            targetUri: d.sourceUri,
            targetRange: d.idRange,
            targetSelectionRange: d.idRange,
          }));
        }

        const entry = model.components[cls].get(ref.id) ?? model.components.connector.get(ref.id);
        if (entry) {
          return [
            {
              originSelectionRange: ref.range,
              targetUri: entry.sourceUri,
              targetRange: entry.idRange,
              targetSelectionRange: entry.idRange,
            },
          ];
        }
      }
    }
  }
  // service.extensions references — same shape, but live outside pipelines.
  for (const ref of member.serviceExtensions) {
    if (!inRange(ref.range, pos)) continue;
    const dup = isDuplicate(model, "extension", ref.id);
    if (dup) {
      return dup.definitions.map((d) => ({
        originSelectionRange: ref.range,
        targetUri: d.sourceUri,
        targetRange: d.idRange,
        targetSelectionRange: d.idRange,
      }));
    }
    const entry = model.components.extension.get(ref.id);
    if (entry) {
      return [
        {
          originSelectionRange: ref.range,
          targetUri: entry.sourceUri,
          targetRange: entry.idRange,
          targetSelectionRange: entry.idRange,
        },
      ];
    }
  }
  // Cross-config extension refs (auth.authenticator, storage, watch_observers, …).
  for (const ref of member.extensionRefs) {
    if (!inRange(ref.range, pos)) continue;
    const entry = model.components.extension.get(ref.id);
    if (entry) {
      return [
        {
          originSelectionRange: ref.range,
          targetUri: entry.sourceUri,
          targetRange: entry.idRange,
          targetSelectionRange: entry.idRange,
        },
      ];
    }
    return null;
  }
  // Pipeline-id refs inside routing/failover connector configs.
  for (const ref of member.pipelineIdRefs) {
    if (!inRange(ref.range, pos)) continue;
    const pipe = model.pipelinesById.get(ref.id);
    if (pipe) {
      return [
        {
          originSelectionRange: ref.range,
          targetUri: pipe.sourceUri,
          targetRange: pipe.range,
          targetSelectionRange: pipe.range,
        },
      ];
    }
    return null;
  }

  // Cursor on a definition site → jump to its usages instead.
  // VS Code shows a peek widget when more than one location is returned,
  // and jumps directly when there's exactly one.
  for (const cls of ["receiver", "processor", "exporter", "connector", "extension"] as const) {
    for (const entry of member.components[cls].values()) {
      if (!inRange(entry.idRange, pos)) continue;
      const refs = pipelineRefsTo(model, cls, entry.id);
      if (refs.length === 0) return null;
      return refs.map((r) => ({
        originSelectionRange: entry.idRange,
        targetUri: r.uri,
        targetRange: r.range,
        targetSelectionRange: r.range,
      }));
    }
  }
  // Cursor on a pipeline definition → list pipeline-id refs (routing/failover).
  for (const pipe of member.pipelines) {
    if (!inRange(pipe.range, pos)) continue;
    const refs = pipelineIdRefsTo(model, pipe.id);
    if (refs.length === 0) return null;
    return refs.map((r) => ({
      originSelectionRange: pipe.range,
      targetUri: r.uri,
      targetRange: r.range,
      targetSelectionRange: r.range,
    }));
  }
  return null;
});

// Find-all-references: given a position on either a component definition
// (the `id:` key in receivers/processors/exporters/connectors) or a pipeline
// reference to that id, return every other pipeline reference across the set,
// plus the definition itself when `includeDeclaration` is set.
connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const set = configSetIndex.getSetForUri(doc.uri);
  const model = set ? buildOrReuseSetModel(set) : singletonSetModel(doc.uri, doc.getText());
  const member = model.members.get(doc.uri);
  if (!member) return null;

  const pos = params.position;
  const includeDecl = params.context?.includeDeclaration ?? true;

  // Resolve the (cls, id) under the cursor — either at a definition site or at a ref site.
  let target: {
    cls: "receiver" | "processor" | "exporter" | "connector" | "extension";
    id: string;
  } | null = null;

  for (const cls of ["receiver", "processor", "exporter", "connector", "extension"] as const) {
    for (const entry of member.components[cls].values()) {
      if (inRange(entry.idRange, pos)) {
        target = { cls, id: entry.id };
        break;
      }
    }
    if (target) break;
  }
  if (!target) {
    outer: for (const pipe of member.pipelines) {
      for (const bucket of ["receivers", "processors", "exporters"] as const) {
        for (const ref of pipe[bucket]) {
          if (inRange(ref.range, pos)) {
            const cls =
              bucket === "receivers"
                ? "receiver"
                : bucket === "processors"
                  ? "processor"
                  : "exporter";
            // Disambiguate: connectors can appear in receivers/exporters lists.
            const isConn =
              model.components.connector.has(ref.id) && !model.components[cls].has(ref.id);
            target = { cls: isConn ? "connector" : cls, id: ref.id };
            break outer;
          }
        }
      }
    }
  }
  if (!target) {
    // service.extensions entry under the cursor.
    for (const ref of member.serviceExtensions) {
      if (inRange(ref.range, pos)) {
        target = { cls: "extension", id: ref.id };
        break;
      }
    }
  }
  if (!target) {
    // Cross-config extension ref (auth.authenticator, storage, watch_observers, etc.).
    for (const ref of member.extensionRefs) {
      if (inRange(ref.range, pos)) {
        target = { cls: "extension", id: ref.id };
        break;
      }
    }
  }
  if (!target) {
    // Pipeline-id ref inside a routing/failover connector → list all pipeline-id refs to it,
    // plus the pipeline definition itself when includeDeclaration is set.
    for (const ref of member.pipelineIdRefs) {
      if (inRange(ref.range, pos)) {
        const locs: Location[] = pipelineIdRefsTo(model, ref.id);
        if (includeDecl) {
          const pipe = model.pipelinesById.get(ref.id);
          if (pipe) locs.push({ uri: pipe.sourceUri, range: pipe.range });
        }
        return locs;
      }
    }
    // Cursor on a pipeline definition (`service.pipelines.<id>:` key) → same result set.
    for (const pipe of member.pipelines) {
      if (inRange(pipe.range, pos)) {
        const locs: Location[] = pipelineIdRefsTo(model, pipe.id);
        if (includeDecl) locs.push({ uri: pipe.sourceUri, range: pipe.range });
        return locs;
      }
    }
  }
  if (!target) return null;

  const locations: Location[] = pipelineRefsTo(model, target.cls, target.id);

  if (includeDecl) {
    const entry = model.components[target.cls].get(target.id);
    if (entry) locations.push({ uri: entry.sourceUri, range: entry.idRange });
  }

  return locations;
});

function inRange(
  r: { start: { line: number; character: number }; end: { line: number; character: number } },
  p: { line: number; character: number },
) {
  if (p.line < r.start.line || p.line > r.end.line) return false;
  if (p.line === r.start.line && p.character < r.start.character) return false;
  if (p.line === r.end.line && p.character > r.end.character) return false;
  return true;
}

// Quiet unused-import lint: fsToUri is exported for potential test use.
void fsToUri;

// Semantic tokens — colors component ids (class) and pipeline ids (namespace),
// flags unreferenced components with the `deprecated` modifier. Uses the
// already-built SetModel so it's cross-file aware (a connector or extension
// reference in another file still counts as "used"). See semantic-tokens.ts
// for the legend and modifier rules.
connection.languages.semanticTokens.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return { data: [] };
  const set = configSetIndex.getSetForUri(doc.uri);
  const model = set ? buildOrReuseSetModel(set) : singletonSetModel(doc.uri, doc.getText());
  const toks = computeSemanticTokens(model, doc.uri);
  return { data: encodeSemanticTokens(toks) };
});

documents.listen(connection);
connection.listen();
