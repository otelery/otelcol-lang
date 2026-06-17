// Config-set discovery.
//
// A "config set" is a group of YAML files that should be analysed together,
// mirroring `otelcol --config a --config b --config c`. The anchor of a set is
// any file declaring `service.pipelines:` at top level. The set's members are
// the anchor itself plus sibling fragments in the anchor's directory and
// subdirectories, stopping at any nested anchor (so staging/ and prod/ form
// independent sets).
//
// Explicit overrides (highest precedence first):
//   1. Sidecar file `configset.otelcol.yaml` in the anchor's directory:
//        members:
//          - base.yaml
//          - exporters.yaml
//          - pipelines.yaml   # anchor must appear in the list
//   2. First-line directive in any file in the set:
//        # configset-otelcol: base.yaml exporters.yaml pipelines.yaml
//
// Discovery is opt-in: if `autoDiscover` is false, only explicit overrides
// create sets — everything else is a single-file set.

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { classifyYaml, HEAD_BYTES, SIDECAR_NAME } from "../common/yaml-classify";

export interface ConfigSet {
  anchorUri: string;
  dir: string;
  members: string[]; // file URIs in confmap order (anchor last for auto-discovered sets)
  explicit: "sidecar" | "directive" | null;
}

interface FileClass {
  uri: string;
  fsPath: string;
  hasPipelines: boolean;
  hasFragmentKeys: boolean;
  directive: string[] | null;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "out", "dist", ".vscode", "build"]);

export interface ConfigSetIndexOptions {
  autoDiscover: boolean;
  maxFilesScanned: number;
}

export class ConfigSetIndex {
  private setsByAnchor = new Map<string, ConfigSet>();
  private setByMember = new Map<string, string /* anchorUri */>();
  private roots: string[] = [];

  constructor(
    private opts: ConfigSetIndexOptions = { autoDiscover: true, maxFilesScanned: 2000 },
  ) {}

  setOptions(opts: ConfigSetIndexOptions): void {
    this.opts = opts;
  }

  setRoots(roots: string[]): void {
    this.roots = roots;
  }

  getSet(anchorUri: string): ConfigSet | null {
    return this.setsByAnchor.get(anchorUri) ?? null;
  }

  getSetForUri(uri: string): ConfigSet | null {
    const anchor = this.setByMember.get(uri);
    return anchor ? (this.setsByAnchor.get(anchor) ?? null) : null;
  }

  allSets(): ConfigSet[] {
    return [...this.setsByAnchor.values()];
  }

  /** Rescan the workspace. Idempotent; replaces previous index. */
  rescan(): void {
    const next = new Map<string, ConfigSet>();
    const nextMember = new Map<string, string>();

    const files = this.walkFiles();
    if (files.length === 0) {
      this.setsByAnchor = next;
      this.setByMember = nextMember;
      return;
    }

    const classified: FileClass[] = files.map((p) => classifyFile(p));
    const anchors = classified.filter((c) => c.hasPipelines);
    const anchorDirs = new Set(anchors.map((a) => path.dirname(a.fsPath)));

    if (this.opts.autoDiscover) {
      for (const a of anchors) {
        const set = this.buildSetForAnchor(a, classified, anchorDirs);
        next.set(a.uri, set);
        for (const m of set.members) nextMember.set(m, a.uri);
      }
    } else {
      // Explicit-only mode: still honour sidecars/directives. Anchor must point at sidecar/directive members.
      for (const a of anchors) {
        const explicit = this.resolveExplicit(a, classified);
        if (!explicit) continue;
        next.set(a.uri, explicit);
        for (const m of explicit.members) nextMember.set(m, a.uri);
      }
    }

    this.setsByAnchor = next;
    this.setByMember = nextMember;
  }

  /** Invalidate a single URI — caller decides whether to call rescan. */
  invalidate(uri: string): void {
    const anchor = this.setByMember.get(uri);
    if (!anchor) return;
    const set = this.setsByAnchor.get(anchor);
    if (!set) return;
    for (const m of set.members) this.setByMember.delete(m);
    this.setsByAnchor.delete(anchor);
  }

  private buildSetForAnchor(
    anchor: FileClass,
    all: FileClass[],
    anchorDirs: Set<string>,
  ): ConfigSet {
    const explicit = this.resolveExplicit(anchor, all);
    if (explicit) return explicit;

    // Auto-discover: BFS members under anchor's dir, stopping at nested anchors.
    const dir = path.dirname(anchor.fsPath);
    const members: string[] = [];
    const seen = new Set<string>();
    for (const f of all) {
      if (f.uri === anchor.uri) continue;
      if (!f.hasFragmentKeys) continue;
      if (!isUnderDir(f.fsPath, dir)) continue;
      // Skip files whose nearest ancestor directory (within `dir`) is itself
      // an anchor directory other than `dir`. Those belong to that anchor.
      if (ownedByNestedAnchor(f.fsPath, dir, anchorDirs)) continue;
      if (seen.has(f.uri)) continue;
      seen.add(f.uri);
      members.push(f.uri);
    }
    // Stable order: alphabetical by path, anchor last.
    members.sort();
    members.push(anchor.uri);
    return { anchorUri: anchor.uri, dir, members, explicit: null };
  }

  private resolveExplicit(anchor: FileClass, all: FileClass[]): ConfigSet | null {
    const dir = path.dirname(anchor.fsPath);
    const sidecarPath = path.join(dir, SIDECAR_NAME);
    if (fs.existsSync(sidecarPath)) {
      const members = parseSidecar(sidecarPath, dir);
      if (members) return { anchorUri: anchor.uri, dir, members, explicit: "sidecar" };
    }
    if (anchor.directive && anchor.directive.length) {
      const members = anchor.directive
        .map((name) => fsToUri(path.resolve(dir, name)))
        .filter((u) => all.some((f) => f.uri === u));
      // Ensure anchor is in members.
      if (!members.includes(anchor.uri)) members.push(anchor.uri);
      return { anchorUri: anchor.uri, dir, members, explicit: "directive" };
    }
    return null;
  }

  private walkFiles(): string[] {
    const out: string[] = [];
    const limit = this.opts.maxFilesScanned;
    for (const root of this.roots) {
      walk(root, out, limit);
      if (out.length >= limit) break;
    }
    return out;
  }
}

function walk(dir: string, out: string[], limit: number): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out, limit);
    } else if (e.isFile()) {
      if (e.name === SIDECAR_NAME) continue; // sidecars themselves are not members
      if (/\.ya?ml$/i.test(e.name)) out.push(full);
    }
  }
}

function classifyFile(fsPath: string): FileClass {
  const uri = fsToUri(fsPath);
  let head = "";
  try {
    const fd = fs.openSync(fsPath, "r");
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
      head = buf.toString("utf8", 0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { uri, fsPath, hasPipelines: false, hasFragmentKeys: false, directive: null };
  }

  const c = classifyYaml(head);
  return {
    uri,
    fsPath,
    hasPipelines: c.hasPipelines,
    hasFragmentKeys: c.hasFragmentKeys,
    directive: c.directive,
  };
}

function parseSidecar(sidecarPath: string, dir: string): string[] | null {
  try {
    const text = fs.readFileSync(sidecarPath, "utf8");
    const parsed = parseYaml(text);
    if (!parsed || typeof parsed !== "object") return null;
    const members = (parsed as any).members;
    if (!Array.isArray(members)) return null;
    return members
      .filter((m: unknown): m is string => typeof m === "string")
      .map((name: string) => fsToUri(path.resolve(dir, name)));
  } catch {
    return null;
  }
}

function isUnderDir(filePath: string, dir: string): boolean {
  const rel = path.relative(dir, filePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// True if a file at `filePath` (inside `anchorDir`) belongs to a *different*
// nested anchor — i.e. its nearest ancestor in `anchorDirs` is not `anchorDir`.
function ownedByNestedAnchor(
  filePath: string,
  anchorDir: string,
  anchorDirs: Set<string>,
): boolean {
  let cur = path.dirname(filePath);
  while (cur.length >= anchorDir.length && cur !== path.dirname(cur)) {
    if (cur === anchorDir) return false;
    if (anchorDirs.has(cur)) return true;
    cur = path.dirname(cur);
  }
  return false;
}

export function fsToUri(fsPath: string): string {
  const resolved = path.resolve(fsPath);
  // Minimal file URI encoding; matches what vscode and `vscode-uri` emit for typical paths.
  const withSlashes = resolved.replace(/\\/g, "/");
  const prefix = withSlashes.startsWith("/") ? "file://" : "file:///";
  return prefix + encodeURI(withSlashes).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

export function uriToFs(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const without = uri.slice("file://".length);
  // Decode and normalise; handle file:/// vs file://host (we don't support hosts).
  const decoded = decodeURIComponent(without.startsWith("/") ? without : "/" + without);
  return path.normalize(decoded);
}
