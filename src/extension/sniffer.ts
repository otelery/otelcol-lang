// File-content sniffer that decides whether a `yaml` document should be
// retagged as `otelcol`. Lives outside extension.ts so it can be unit-tested
// without pulling in the `vscode` module.

import * as fs from "node:fs";
import * as path from "node:path";

const OTELCOL_KEY_LINE = /^(service|receivers|exporters|processors|connectors|extensions):\s*(#.*)?$/gm;
const OTELCOL_ANCHOR = /^service:\s*(#.*)?\n(?:[ \t]+\S.*\n){0,200}?[ \t]+pipelines:/m;
const DIRECTIVE_RE = /^#\s*otelcol-configset:\s*(.+)$/m;
const SIDECAR_NAME = "otelcol-configset.yaml";
const SIBLING_SCAN_LIMIT = 50;

// A file is treated as an otelcol document if any of these hold:
//   (a) it's an anchor (`service:` + indented `pipelines:`), OR
//   (b) it has two or more of {service, receivers, processors, exporters, connectors, extensions} at column 0, OR
//   (c) it has an `# otelcol-configset:` first-line directive, OR
//   (d) a sibling `otelcol-configset.yaml` sidecar exists, OR
//   (e) a sibling YAML in the same directory carries an `# otelcol-configset:`
//       directive that names this file. Covers single-section fragments like
//       `base.yaml` that only declare `receivers:` but are pulled into a set
//       by a directive in `pipelines.yaml`.
//   (f) any sibling YAML in the same directory is itself an otelcol anchor
//       (has `service:` + indented `pipelines:`). Covers the implicit grouping
//       case: a one-key fragment like `base.yaml`/`exporters.yaml` sitting
//       next to a `pipelines.yaml` anchor, with no directive or sidecar.
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
  // (e)+(f) Scan sibling YAMLs once: any one that either lists this file
  // in an `# otelcol-configset:` directive, or is itself an anchor with
  // `service:` + indented `pipelines:`, is enough to retag.
  try {
    const self = path.basename(fsPath);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let scanned = 0;
    for (const ent of entries) {
      if (scanned >= SIBLING_SCAN_LIMIT) break;
      if (!ent.isFile()) continue;
      if (ent.name === self) continue;
      if (!/\.(ya?ml)$/i.test(ent.name)) continue;
      scanned++;
      let head2: string;
      try {
        const fd = fs.openSync(path.join(dir, ent.name), "r");
        const buf = Buffer.alloc(16 * 1024);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        head2 = buf.subarray(0, n).toString("utf8");
      } catch {
        continue;
      }
      // (e) directive that names this file
      const dm = DIRECTIVE_RE.exec(head2);
      if (dm) {
        const members = dm[1].trim().split(/\s+/);
        if (members.includes(self)) return true;
      }
      // (f) sibling is an anchor
      if (OTELCOL_ANCHOR.test(head2)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
