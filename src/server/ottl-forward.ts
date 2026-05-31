// OTTL diagnostics. Embeds an ottl-lsp child process and forwards each OTTL
// block as a virtual document (per README §3.2). If no ottl-lsp is configured
// or available, this layer is a no-op — the YAML/pipeline diagnostics still
// flow.
//
// The forwarder is intentionally minimal: it issues textDocument/didOpen +
// didClose for each block on every change, expects diagnostics back via
// textDocument/publishDiagnostics, and translates the inner ranges back to
// the parent YAML range before publishing.

import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { Diagnostic, DiagnosticSeverity, Position, Range } from "vscode-languageserver";
import type { OttlBlock } from "./yaml-model";

interface Pending {
  resolve: (diags: Diagnostic[]) => void;
  block: OttlBlock;
}

export class OttlForwarder {
  private proc: ChildProcess | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private ready = false;

  constructor(private readonly ottlLspPath: string) {}

  start(): boolean {
    if (!this.ottlLspPath || !existsSync(this.ottlLspPath)) return false;
    try {
      this.proc = spawn(process.execPath, [this.ottlLspPath, "--stdio"], { stdio: ["pipe", "pipe", "inherit"] });
    } catch {
      return false;
    }
    this.proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.on("exit", () => {
      this.proc = null;
      this.ready = false;
    });
    this.send({ jsonrpc: "2.0", id: this.nextId++, method: "initialize", params: { processId: process.pid, rootUri: null, capabilities: {} } });
    this.send({ jsonrpc: "2.0", method: "initialized", params: {} });
    this.ready = true;
    return true;
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
    this.ready = false;
  }

  async diagnose(blocks: OttlBlock[]): Promise<Array<{ sourceUri: string; diagnostic: Diagnostic }>> {
    if (!this.ready || !this.proc) return [];
    const out: Array<{ sourceUri: string; diagnostic: Diagnostic }> = [];
    for (const block of blocks) {
      const diags = await this.diagnoseBlock(block).catch(() => [] as Diagnostic[]);
      for (const d of diags) {
        out.push({
          sourceUri: block.sourceUri,
          diagnostic: { ...d, range: translateRange(d.range, block.range), source: "ottl" },
        });
      }
    }
    return out;
  }

  private diagnoseBlock(block: OttlBlock): Promise<Diagnostic[]> {
    const uri = `ottl-${block.kind}://block-${this.nextId++}.ottl`;
    return new Promise((resolve) => {
      this.pending.set(uri, { resolve, block });
      this.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "ottl", version: 1, text: block.text } },
      });
      // Settle after a short window if no diagnostics arrive.
      setTimeout(() => {
        if (this.pending.has(uri)) {
          this.pending.delete(uri);
          resolve([]);
        }
        this.send({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } });
      }, 300);
    });
  }

  private onData(chunk: Buffer) {
    this.buf += chunk.toString("utf8");
    while (true) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buf.slice(0, headerEnd);
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        this.buf = this.buf.slice(headerEnd + 4);
        continue;
      }
      const len = parseInt(m[1], 10);
      const total = headerEnd + 4 + len;
      if (this.buf.length < total) return;
      const body = this.buf.slice(headerEnd + 4, total);
      this.buf = this.buf.slice(total);
      try {
        const msg = JSON.parse(body);
        this.onMessage(msg);
      } catch {
        // ignore malformed
      }
    }
  }

  private onMessage(msg: any) {
    if (msg.method === "textDocument/publishDiagnostics") {
      const uri = msg.params?.uri;
      const p = this.pending.get(uri);
      if (p) {
        this.pending.delete(uri);
        p.resolve(msg.params?.diagnostics ?? []);
      }
    }
  }

  private send(msg: unknown) {
    if (!this.proc?.stdin) return;
    const body = JSON.stringify(msg);
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }
}

// Translate a diagnostic range (offsets inside the OTTL block text) into the
// parent YAML range. The OTTL block range starts at the opening quote of the
// scalar (yaml package convention); shift by line offsets accordingly.
function translateRange(inner: Range, outer: Range): Range {
  return {
    start: shift(inner.start, outer.start),
    end: shift(inner.end, outer.start),
  };
}

function shift(p: Position, base: Position): Position {
  if (p.line === 0) return { line: base.line, character: base.character + p.character };
  return { line: base.line + p.line, character: p.character };
}
