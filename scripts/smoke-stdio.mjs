#!/usr/bin/env node
// stdio smoke test: spawn the bin shim, drive the LSP handshake by hand,
// assert the server advertises the capabilities editors rely on.
//
// Run after `npm run compile` so dist/ exists.

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const bin = resolve(root, "bin", "otelcol-language-server.js");
const exampleDir = resolve(root, "examples", "simple");

const proc = spawn(process.execPath, [bin, "--stdio"], {
  cwd: root,
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = Buffer.alloc(0);
const pending = new Map();
let nextId = 1;

proc.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) {
      fail(`malformed LSP header: ${JSON.stringify(header)}`);
      return;
    }
    const len = Number(m[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) return;
    const body = buffer.slice(bodyStart, bodyStart + len).toString("utf8");
    buffer = buffer.slice(bodyStart + len);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch (e) {
      fail(`bad JSON from server: ${e.message}`);
      return;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve: r } = pending.get(msg.id);
      pending.delete(msg.id);
      r(msg);
    }
  }
});

function send(msg) {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
  proc.stdin.write(header + body);
}

function request(method, params) {
  const id = nextId++;
  const p = new Promise((r) => pending.set(id, { resolve: r }));
  send({ jsonrpc: "2.0", id, method, params });
  return p;
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
  process.exit(1);
}

const timeout = setTimeout(() => fail("timeout waiting for initialize response"), 10000);

try {
  const initResp = await request("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(exampleDir).href,
    workspaceFolders: [{ uri: pathToFileURL(exampleDir).href, name: "simple" }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: { hover: {}, completion: {} },
    },
  });
  clearTimeout(timeout);

  const caps = initResp.result?.capabilities;
  if (!caps) fail("initialize response missing capabilities");
  const checks = {
    hoverProvider: caps.hoverProvider,
    completionProvider: caps.completionProvider,
    definitionProvider: caps.definitionProvider,
    semanticTokensProvider: caps.semanticTokensProvider,
  };
  for (const [k, v] of Object.entries(checks)) {
    if (!v) fail(`server did not advertise ${k}`);
  }
  console.log("server capabilities OK:");
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${k}: ${typeof v === "object" ? "object" : v}`);
  }

  notify("initialized", {});
  await request("shutdown", null);
  notify("exit", null);
} catch (e) {
  fail(e?.message ?? String(e));
}

proc.on("exit", (code) => {
  // graceful shutdown via exit notification → code 0
  if (code !== 0 && code !== null) fail(`server exited with code ${code}`);
  process.exit(0);
});
