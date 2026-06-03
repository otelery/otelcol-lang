// File-content sniffer that decides whether a `yaml` document should be
// retagged as `otelcol`. Lives outside extension.ts so it can be unit-tested
// without pulling in the `vscode` module.

import * as fs from "node:fs";
import * as path from "node:path";

const OTELCOL_KEY_LINE =
  /^(service|receivers|exporters|processors|connectors|extensions):\s*(#.*)?$/gm;
const OTELCOL_ANCHOR = /^service:\s*(#.*)?\n(?:[ \t]+\S.*\n){0,200}?[ \t]+pipelines:/m;
const DIRECTIVE_RE = /^#\s*otelcol-configset:\s*(.+)$/m;
const SIDECAR_NAME = "otelcol-configset.yaml";
const SIBLING_SCAN_LIMIT = 50;
const MAX_SEARCH_DEPTH = 5; // Prevent runaway recursion

const SERVICE_PIPELINES_RE =
  /^service:\s*(#.*)?\n(?:[ \t]+\S.*\n){0,200}?[ \t]+pipelines:\s*(#.*)?(?:\n|$)/m;

// Check if a directory or any of its parent directories contains `service.pipelines`.
function directoryOrParentHasAnchor(dir: string, depth = 0): boolean {
  if (depth >= MAX_SEARCH_DEPTH) return false;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (!/\.(ya?ml)$/i.test(ent.name)) continue;

      try {
        const fullPath = path.join(dir, ent.name);
        const fd = fs.openSync(fullPath, "r");
        const buf = Buffer.alloc(16 * 1024);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        if (SERVICE_PIPELINES_RE.test(buf.subarray(0, n).toString("utf8"))) return true;
      } catch {
        continue;
      }
    }

    // Recurse to parent if not found
    const parent = path.dirname(dir);
    if (parent !== dir) return directoryOrParentHasAnchor(parent, depth + 1);
  } catch {
    /* ignore */
  }
  return false;
}

// A file is treated as an otelcol document if any of these hold:
//   (a) it's an anchor (`service:` + indented `pipelines:`), OR
//   (b) it has two or more of {service, receivers, processors, exporters, connectors, extensions} at column 0, OR
//   (c) it has an `# otelcol-configset:` first-line directive, OR
//   (d) a sibling `otelcol-configset.yaml` sidecar exists, OR
//   (e) a sibling YAML in the same directory carries an `# otelcol-configset:`
//       directive that names this file.
//   (f) any YAML in this or a parent directory contains `service.pipelines`.
export function looksLikeOtelcol(text: string, fsPath: string | null): boolean {
  const head = text.slice(0, 16 * 1024);
  if (/^#\s*otelcol-configset:/m.test(head)) return true;
  if (OTELCOL_ANCHOR.test(head)) return true;
  const found = new Set<string>();
  OTELCOL_KEY_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OTELCOL_KEY_LINE.exec(head))) {
    found.add(m[1]);
    if (found.size >= 2) return true;
  }
  if (!fsPath) return false;

  const dir = path.dirname(fsPath);
  try {
    if (fs.existsSync(path.join(dir, SIDECAR_NAME))) return true;
  } catch {
    /* ignore */
  }

  // Check new directory or parent based anchor
  if (directoryOrParentHasAnchor(dir)) return true;

  // Existing sibling scan for directives
  try {
    const self = path.basename(fsPath);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let scanned = 0;
    for (const ent of entries) {
      if (scanned >= SIBLING_SCAN_LIMIT) break;
      if (!ent.isFile()) continue;
      if (!/\.(ya?ml)$/i.test(ent.name)) continue;

      let head2: string;
      try {
        const fullPath = path.join(dir, ent.name);
        const fd = fs.openSync(fullPath, "r");
        const buf = Buffer.alloc(16 * 1024);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        head2 = buf.subarray(0, n).toString("utf8");
      } catch {
        continue;
      }
      scanned++;

      // Existing sibling directives
      if (ent.name !== self) {
        const dm = DIRECTIVE_RE.exec(head2);
        if (dm) {
          const members = dm[1].trim().split(/\s+/);
          if (members.includes(self)) return true;
        }
        if (OTELCOL_ANCHOR.test(head2)) return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}
