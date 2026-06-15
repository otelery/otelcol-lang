// Integration test for textDocument/completion. Boots the bundled
// server over stdio and drives it with hand-rolled LSP messages,
// asserting that completion under a pipeline body returns the
// canonical bucket names. Mirrors integration-server-sniff.test.mjs
// (same Content-Length framing, same dist-missing skip guard).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const serverEntry = resolve(root, "dist", "server", "server.js");

if (!existsSync(serverEntry)) {
  describe("completion integration (skipped — dist/server/server.js missing)", () => {
    it.skip("requires `make bundle` (or `node esbuild.js`) before running");
  });
} else {
  describe("completion integration (textDocument/completion)", () => {
    let workdir;
    let proc;
    let nextId = 1;
    const pending = new Map();

    function send(msg) {
      const body = JSON.stringify(msg);
      proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    }
    function request(method, params) {
      const id = nextId++;
      const p = new Promise((r) => pending.set(id, r));
      send({ jsonrpc: "2.0", id, method, params });
      return p;
    }
    function notify(method, params) {
      send({ jsonrpc: "2.0", method, params });
    }

    before(async () => {
      workdir = mkdtempSync(join(tmpdir(), "otelcol-completion-"));
      proc = spawn(process.execPath, [serverEntry, "--stdio"], {
        cwd: workdir,
        stdio: ["pipe", "pipe", "inherit"],
      });
      let buffer = Buffer.alloc(0);
      proc.stdout.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;
          const m = buffer
            .slice(0, headerEnd)
            .toString("utf8")
            .match(/Content-Length:\s*(\d+)/i);
          if (!m) return;
          const len = Number(m[1]);
          const bodyStart = headerEnd + 4;
          if (buffer.length < bodyStart + len) return;
          const body = buffer.slice(bodyStart, bodyStart + len).toString("utf8");
          buffer = buffer.slice(bodyStart + len);
          const msg = JSON.parse(body);
          if (msg.id != null && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
        }
      });
      const initResp = await request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(workdir).href,
        workspaceFolders: [{ uri: pathToFileURL(workdir).href, name: "scratch" }],
        capabilities: {},
      });
      assert.ok(initResp.result?.capabilities, "initialize returned no capabilities");
      notify("initialized", {});
    });

    after(() => {
      try {
        notify("exit", null);
      } catch {
        /* ignore */
      }
      try {
        proc?.kill();
      } catch {
        /* ignore */
      }
      if (workdir) rmSync(workdir, { recursive: true, force: true });
    });

    it("suggests pipeline buckets on a blank line inside a pipeline body", async () => {
      const file = join(workdir, "pipeline-body.yaml");
      const text =
        "receivers:\n" +
        "  otlp:\n" +
        "exporters:\n" +
        "  debug:\n" +
        "service:\n" +
        "  pipelines:\n" +
        "    test:\n" +
        "      \n";
      writeFileSync(file, text);
      const uri = pathToFileURL(file).href;
      notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "otelcol", version: 1, text },
      });
      const resp = await request("textDocument/completion", {
        textDocument: { uri },
        position: { line: 7, character: 6 },
      });
      const items = Array.isArray(resp.result) ? resp.result : resp.result?.items ?? [];
      const labels = items.map((i) => i.label);
      for (const bucket of ["receivers", "processors", "exporters"]) {
        assert.ok(
          labels.includes(bucket),
          `expected '${bucket}' in pipeline-body completion; got: ${labels}`,
        );
      }
      for (const wrong of ["connectors", "extensions", "service"]) {
        assert.ok(
          !labels.includes(wrong),
          `unexpected '${wrong}' in pipeline-body completion; got: ${labels}`,
        );
      }
    });

    it("suggests schema property keys on a blank line inside a component instance", async () => {
      const file = join(workdir, "component-body.yaml");
      const text = "receivers:\n  otlp:\n    \n";
      writeFileSync(file, text);
      const uri = pathToFileURL(file).href;
      notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "otelcol", version: 1, text },
      });
      const resp = await request("textDocument/completion", {
        textDocument: { uri },
        position: { line: 2, character: 4 },
      });
      const items = Array.isArray(resp.result) ? resp.result : resp.result?.items ?? [];
      const labels = items.map((i) => i.label);
      assert.ok(
        labels.includes("protocols"),
        `expected 'protocols' in otlp schema-key completion; got: ${labels.slice(0, 20)}`,
      );
      const protocols = items.find((i) => i.label === "protocols");
      assert.ok(
        protocols?.documentation && typeof protocols.documentation === "object",
        "schema-property items should carry markdown documentation",
      );
      assert.equal(protocols.documentation.kind, "markdown");
      assert.ok(
        protocols.documentation.value.includes("**`protocols`**"),
        `documentation should be schema-derived markdown; got: ${protocols.documentation.value?.slice(0, 120)}`,
      );
    });
  });
}
