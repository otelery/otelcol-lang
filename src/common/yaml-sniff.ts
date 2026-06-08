// Shared "is this YAML actually an otelcol config?" detector. Used by:
//   - editors/vscode/src/sniffer.ts (and the legacy src/extension/sniffer.ts
//     mirror) — to retag yaml documents to `otelcol` at open-time
//   - src/server/server.ts — as a server-side fallback for editors (Zed,
//     Helix) that can't retag client-side
//
// The rules — applied in order, first match wins — are:
//   1. `# otelcol-configset:` directive marker anywhere in the head, OR
//   2. filename basename is `otelcol-configset.yaml`, OR
//   3. parsed structure has either `service.pipelines` (anchor) or ≥2
//      top-level otelcol keys, OR
//   4. a sibling `otelcol-configset.yaml` sidecar exists in the same dir, OR
//   5. a sibling YAML in the same dir either names this file via an
//      `# otelcol-configset:` directive or is itself an anchor.

import * as fs from "node:fs";
import * as path from "node:path";
import { classifyYaml, DIRECTIVE_MARKER_RE, HEAD_BYTES, SIDECAR_NAME } from "./yaml-classify";

const SIBLING_SCAN_LIMIT = 50;

export type SnifferLogger = (msg: string) => void;

function readHead(p: string): string | null {
  try {
    const fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  }
}

export function looksLikeOtelcol(
  text: string,
  fsPath: string | null,
  log?: SnifferLogger,
): boolean {
  const tag = fsPath ?? "<unsaved>";
  const head = text.length > HEAD_BYTES ? text.slice(0, HEAD_BYTES) : text;

  if (DIRECTIVE_MARKER_RE.test(head)) {
    log?.(`${tag}: match rule 1 (directive marker comment)`);
    return true;
  }

  const selfName = fsPath ? path.basename(fsPath) : null;
  if (selfName === SIDECAR_NAME) {
    log?.(`${tag}: match rule 2 (filename is ${SIDECAR_NAME})`);
    return true;
  }

  const self = classifyYaml(text);
  log?.(
    `${tag}: parsed shape — service.pipelines=${self.hasPipelines}, otelcolKeys=${self.otelcolKeys}`,
  );
  if (self.hasPipelines) {
    log?.(`${tag}: match rule 3a (service.pipelines anchor)`);
    return true;
  }
  if (self.otelcolKeys >= 2) {
    log?.(`${tag}: match rule 3b (${self.otelcolKeys} top-level otelcol keys)`);
    return true;
  }
  if (self.otelcolKeys === 0) {
    log?.(`${tag}: no match — zero otelcol top-level keys, skipping sibling scan`);
    return false;
  }

  if (!fsPath || !selfName) {
    log?.(`${tag}: no match — single-key fragment but no fsPath, can't check siblings`);
    return false;
  }
  const dir = path.dirname(fsPath);

  try {
    if (fs.existsSync(path.join(dir, SIDECAR_NAME))) {
      log?.(`${tag}: match rule 4 (sibling sidecar ${SIDECAR_NAME} exists in ${dir})`);
      return true;
    }
  } catch {
    /* ignore */
  }

  try {
    let scanned = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    log?.(`${tag}: sibling scan in ${dir} — ${entries.length} entries`);
    for (const ent of entries) {
      if (scanned >= SIBLING_SCAN_LIMIT) break;
      if (!ent.isFile()) continue;
      if (!/\.(ya?ml)$/i.test(ent.name)) continue;
      if (ent.name === selfName) continue;
      scanned++;

      const h = readHead(path.join(dir, ent.name));
      if (h === null) {
        log?.(`${tag}: sibling ${ent.name} — could not read`);
        continue;
      }

      const sib = classifyYaml(h);
      if (sib.directive && sib.directive.includes(selfName)) {
        log?.(`${tag}: match rule 5a (sibling ${ent.name} directive names ${selfName})`);
        return true;
      }
      if (sib.hasPipelines) {
        log?.(`${tag}: match rule 5b (sibling ${ent.name} is anchor)`);
        return true;
      }
    }
    log?.(`${tag}: no match — scanned ${scanned} sibling(s), none qualified`);
  } catch (err) {
    log?.(`${tag}: sibling scan threw — ${err instanceof Error ? err.message : String(err)}`);
  }

  return false;
}
