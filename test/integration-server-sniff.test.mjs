// Integration test for the server-side YAML sniffer
// (`otelcol.attachToYaml` workspace setting). Drives the bundled
// server over stdio with hand-rolled LSP messages and asserts the
// correct opt-in / opt-out behaviour.
//
// Skipped when dist/server/server.js doesn't exist — production
// build is required (`make bundle` or `node esbuild.js`). The
// test/run-tests.mjs unit suite doesn't depend on bundling and
// must not break in that case.

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
  describe("server-side sniffer (skipped — dist/server/server.js missing)", () => {
    it.skip("requires `make bundle` (or `node esbuild.js`) before running");
  });
} else {
  describe("server-side sniffer (otelcol.attachToYaml)", () => {
    let workdir;
    let proc;
    let nextId = 1;
    const pending = new Map();
    const diagnosticsByUri = new Map();

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
    async function waitForDiagnostics(uri, timeoutMs = 1500) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (diagnosticsByUri.has(uri)) return diagnosticsByUri.get(uri);
        await new Promise((r) => setTimeout(r, 30));
      }
      return null;
    }

    before(async () => {
      workdir = mkdtempSync(join(tmpdir(), "otelcol-srv-sniff-"));
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
            continue;
          }
          if (msg.method === "textDocument/publishDiagnostics") {
            diagnosticsByUri.set(msg.params.uri, msg.params.diagnostics);
          }
        }
      });
      const initResp = await request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(workdir).href,
        workspaceFolders: [{ uri: pathToFileURL(workdir).href, name: "scratch" }],
        capabilities: { workspace: { configuration: true } },
        initializationOptions: { attachToYaml: true },
      });
      assert.ok(initResp.result?.capabilities?.semanticTokensProvider);
      notify("initialized", {});
      // Pass settings via didChangeConfiguration so applySettings runs.
      notify("workspace/didChangeConfiguration", {
        settings: { otelcol: { attachToYaml: true } },
      });
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

    it("opens an anchor-shaped yaml and emits diagnostics + semantic tokens", async () => {
      const file = join(workdir, "anchor-sniff.yaml");
      const text =
        "service:\n" +
        "  pipelines:\n" +
        "    traces:\n" +
        "      receivers: [otlp]\n" +
        "      processors: [batch]\n" +
        "      exporters: [debug]\n" +
        "receivers:\n  otlp:\n    protocols:\n      grpc: {}\n" +
        "processors:\n  batch: {}\n" +
        "exporters:\n  debug: {}\n";
      writeFileSync(file, text);
      const uri = pathToFileURL(file).href;
      notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "yaml", version: 1, text },
      });
      // Sniffer should accept this as otelcol (rule 3a). Diagnostics may be
      // empty (the file validates clean) but the semantic-tokens response
      // should contain encoded tokens for the component IDs.
      await waitForDiagnostics(uri, 500); // may or may not arrive; not required
      const tokResp = await request("textDocument/semanticTokens/full", {
        textDocument: { uri },
      });
      assert.ok(tokResp.result, "semanticTokens/full returned no result");
      assert.ok(
        Array.isArray(tokResp.result.data) && tokResp.result.data.length > 0,
        "expected non-empty semantic tokens for sniffed otelcol yaml",
      );
    });

    it("opens an unrelated yaml and emits NO semantic tokens", async () => {
      const file = join(workdir, "plain.yaml");
      const text = "name: alice\nage: 42\nhobbies:\n  - chess\n  - tea\n";
      writeFileSync(file, text);
      const uri = pathToFileURL(file).href;
      notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "yaml", version: 1, text },
      });
      const tokResp = await request("textDocument/semanticTokens/full", {
        textDocument: { uri },
      });
      // Sniffer rejects → server doesn't adopt → handler returns nothing /
      // empty data. Both shapes are acceptable.
      const data = tokResp.result?.data;
      assert.ok(!data || data.length === 0, `expected no tokens, got ${JSON.stringify(data)}`);
    });
  });
}
