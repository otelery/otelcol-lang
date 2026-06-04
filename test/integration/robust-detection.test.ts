import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "otelery.vscode-otelcol";

async function waitFor<T>(
  predicate: () => T | undefined | Promise<T | undefined>,
  { timeoutMs = 10000, intervalMs = 200 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value !== undefined && value !== false) return value as T;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor: predicate never became truthy within ${timeoutMs}ms`);
}

describe("Robust Detection Integration", () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    await ext.activate();
  });

  it("retags fragment alongside an anchor sibling", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otelcol-repro-"));
    const anchorDir = path.join(tmpDir, "main");

    fs.mkdirSync(anchorDir);

    const anchorFile = path.join(anchorDir, "pipelines.yaml");
    const fragmentFile = path.join(anchorDir, "myexporter.yaml");

    fs.writeFileSync(anchorFile, "service:\n  pipelines:\n    traces:\n      receivers: [otlp]\n");
    fs.writeFileSync(fragmentFile, "exporters:\n  debug:\n");

    try {
      const uri = vscode.Uri.file(fragmentFile);
      const doc = await vscode.workspace.openTextDocument(uri);
      // Ensure file is open in editor
      await vscode.window.showTextDocument(doc);

      // Verify retagging
      const finalDoc = await waitFor(() =>
        vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === uri.toString() && d.languageId === "otelcol",
        ),
      );
      assert.equal(
        finalDoc.languageId,
        "otelcol",
        "Fragment alongside anchor sibling should be retagged as 'otelcol'",
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Checked-in fixture: an anchor with a blank line inside `service:`
  // (between `telemetry:` and `pipelines:`) used to break the old regex
  // detector. Exercises the same VS Code retag pathway F5 uses.
  // Compiled to out/test/integration/robust-detection.test.js — 3 levels
  // up lands at the repo root.
  const BLANK_LINE_DIR = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "test",
    "configsets",
    "blank-line-anchor",
  );
  for (const name of ["pipelines.yaml", "receivers.yaml", "processors.yaml", "exporters.yaml"]) {
    it(`retags fixture blank-line-anchor/${name} through VS Code`, async () => {
      const filePath = path.join(BLANK_LINE_DIR, name);
      assert.ok(fs.existsSync(filePath), `fixture missing: ${filePath}`);
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      const finalDoc = await waitFor(() =>
        vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === uri.toString() && d.languageId === "otelcol",
        ),
      );
      assert.equal(finalDoc.languageId, "otelcol", `${name} should retag to 'otelcol'`);
    });
  }
});
