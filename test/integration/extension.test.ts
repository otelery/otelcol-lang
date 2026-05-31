import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
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

    it("does NOT retag generic YAML files that are not collector configs", async () => {
      // A YAML file with only one top-level key that isn't an otelcol section,
      // alone in its directory (no sibling anchor, no sidecar, no directive).
      // The sniffer's rules a–f should ALL miss this — languageId must stay 'yaml'.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otelcol-notretag-"));
      const tmpFile = path.join(tmpDir, "package-info.yaml");
      fs.writeFileSync(
        tmpFile,
        "# Random YAML, not an otelcol config.\nname: my-app\nversion: 1.2.3\nmaintainer: ops@example.com\n",
      );

      try {
        const uri = vscode.Uri.file(tmpFile);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);

        // Give the sniffer ample time to consider and (correctly) reject.
        await new Promise((r) => setTimeout(r, 1500));

        const current = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === uri.toString(),
        );
        assert.ok(current, "expected the document to still be open");
        assert.equal(
          current.languageId,
          "yaml",
          `generic YAML was incorrectly retagged to ${current.languageId}; sniffer false positive`,
        );

        // No diagnostics should be published — the otelcol LSP must not process
        // documents it didn't claim.
        const diags = vscode.languages.getDiagnostics(uri);
        assert.equal(
          diags.length,
          0,
          `otelcol LSP leaked diagnostics into a non-otelcol document: ${JSON.stringify(diags.map((d) => d.message))}`,
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("diagnostics", () => {
    it("publishes diagnostics for examples/diagnostics/broken.yaml end-to-end", async () => {
      const fixturePath = path.resolve(__dirname, "../../../examples/diagnostics/broken.yaml");
      const uri = vscode.Uri.file(fixturePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      // Wait for the LSP to publish at least one diagnostic. Diagnostics flow
      // through publishDiagnostics asynchronously after the server validates.
      const diagnostics = await waitFor(
        () => {
          const d = vscode.languages.getDiagnostics(uri);
          return d.length > 0 ? d : undefined;
        },
        { timeoutMs: 10000, intervalMs: 200 },
      );

      // The fixture deliberately contains:
      //   - exporters: [does_not_exist]   → undefined exporter reference
      //   - bogus_exporter_type           → unknown component type
      //   - nonsense_signal               → invalid pipeline signal name
      // At minimum, the undefined-reference diagnostic must surface.
      const messages = diagnostics.map((d) => d.message);
      assert.ok(
        messages.some((m) => /does_not_exist/.test(m)),
        `expected a diagnostic naming the undefined 'does_not_exist' exporter; got: ${JSON.stringify(messages)}`,
      );

      // At least one diagnostic must be Error severity (the undefined ref is
      // an error in the pipeline validator).
      assert.ok(
        diagnostics.some((d) => d.severity === vscode.DiagnosticSeverity.Error),
        `expected at least one Error-severity diagnostic; got severities ${JSON.stringify(
          diagnostics.map((d) => d.severity),
        )}`,
      );

      // Every diagnostic must carry a sensible range (non-empty span on a real line).
      for (const d of diagnostics) {
        assert.ok(d.range, `diagnostic missing range: ${d.message}`);
        assert.ok(d.range.start.line >= 0);
        const startBeforeEnd =
          d.range.end.line > d.range.start.line ||
          (d.range.end.line === d.range.start.line &&
            d.range.end.character > d.range.start.character);
        assert.ok(startBeforeEnd, `range start must precede end for: ${d.message}`);
      }
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
