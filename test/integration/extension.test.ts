import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "otelery.vscode-otelcol";

async function waitFor<T>(
  predicate: () => T | undefined | Promise<T | undefined>,
  { timeoutMs = 5000, intervalMs = 100 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value !== undefined && value !== false) return value as T;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor: predicate never became truthy within ${timeoutMs}ms`);
}

describe("vscode-otelcol extension", () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found in Extension Host`);
    await ext.activate();
  });

  describe("activation and contributions", () => {
    it("registers the otelcol and ottl languages", async () => {
      const languages = await vscode.languages.getLanguages();
      assert.ok(languages.includes("otelcol"), "otelcol language missing");
      assert.ok(languages.includes("ottl"), "ottl language missing");
    });

    it("activates without error", () => {
      const ext = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(ext);
      assert.equal(ext.isActive, true);
    });
  });

  describe("language detection", () => {
    it("retags a YAML collector config as otelcol", async () => {
      const fixturePath = path.resolve(__dirname, "../../../test/simple/otelcol-config.yaml");
      const uri = vscode.Uri.file(fixturePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      // Sniffer runs asynchronously after activation — wait for the retag.
      const finalDoc = await waitFor(() =>
        vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === uri.toString() && d.languageId === "otelcol",
        ),
      );
      assert.equal(finalDoc.languageId, "otelcol");
    });
  });

  describe("hover provider", () => {
    it("returns hover content on a known receiver type", async () => {
      const fixturePath = path.resolve(__dirname, "../../../test/simple/otelcol-config.yaml");
      const uri = vscode.Uri.file(fixturePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      // Find the first occurrence of a known receiver type ("otlp") inside `receivers:`
      const text = doc.getText();
      const offset = text.indexOf("otlp", text.indexOf("receivers:"));
      assert.ok(offset > 0, "expected `otlp` receiver in test fixture");
      const position = doc.positionAt(offset + 1);

      // The LSP may not be ready immediately after activation — retry until
      // the hover provider yields content (server has loaded its schema/component registry).
      const hovers = await waitFor(
        async () => {
          const result = (await vscode.commands.executeCommand(
            "vscode.executeHoverProvider",
            uri,
            position,
          )) as vscode.Hover[];
          return Array.isArray(result) && result.length > 0 ? result : undefined;
        },
        { timeoutMs: 10000, intervalMs: 200 },
      );

      const md = hovers
        .flatMap((h) => h.contents)
        .map((c) => (typeof c === "string" ? c : c.value))
        .join("\n");
      assert.match(md, /otlp/i, "hover should mention the otlp receiver");
    });
  });
});
