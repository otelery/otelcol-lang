import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "otelery.vscode-otelcol";
// out/test/integration/crossfile/ → repo root (up 4)
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

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

describe("cross-file features (complex workspace)", () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found in Extension Host`);
    await ext.activate();
  });

  describe("definition provider (F12)", () => {
    it("jumps from a pipeline ref in pipelines.yaml to the receiver def in base.yaml", async () => {
      const pipelinesUri = vscode.Uri.file(path.join(REPO_ROOT, "test/complex/pipelines.yaml"));
      const baseUri = vscode.Uri.file(path.join(REPO_ROOT, "test/complex/base.yaml"));

      // Open both members so the config-set has full context.
      await vscode.workspace.openTextDocument(baseUri);
      const pipelinesDoc = await vscode.workspace.openTextDocument(pipelinesUri);
      await vscode.window.showTextDocument(pipelinesDoc);

      // Position the cursor on a `otlp` token inside service.pipelines.*.receivers.
      const text = pipelinesDoc.getText();
      const serviceIdx = text.indexOf("service:");
      assert.ok(serviceIdx > 0, "fixture must contain a `service:` block");
      const otlpRefIdx = text.indexOf("otlp", serviceIdx);
      assert.ok(
        otlpRefIdx > 0,
        "expected an `otlp` reference inside service.pipelines.*.receivers",
      );
      const position = pipelinesDoc.positionAt(otlpRefIdx + 1);

      const defs = await waitFor(async () => {
        const result = (await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",
          pipelinesUri,
          position,
        )) as Array<vscode.Location | vscode.LocationLink>;
        return Array.isArray(result) && result.length > 0 ? result : undefined;
      });

      // Normalise Location | LocationLink → URI.
      const targetUri =
        (defs[0] as vscode.Location).uri ?? (defs[0] as vscode.LocationLink).targetUri;
      assert.ok(targetUri, "definition result missing uri/targetUri");
      assert.equal(
        targetUri.toString(),
        baseUri.toString(),
        `expected jump into base.yaml, got ${targetUri.toString()}`,
      );

      // The target range should land on a line that defines `otlp` (the line
      // starts with whitespace + `otlp:` in base.yaml's receivers block).
      const targetRange =
        (defs[0] as vscode.Location).range ?? (defs[0] as vscode.LocationLink).targetRange;
      const baseDoc = await vscode.workspace.openTextDocument(baseUri);
      const targetLine = baseDoc.getText().split("\n")[targetRange.start.line];
      assert.match(
        targetLine,
        /^\s*otlp\s*:/,
        `expected target line to define \`otlp:\`; got ${JSON.stringify(targetLine)}`,
      );
    });

    it("jumps from a pipeline ref to an exporter def in a sibling file", async () => {
      const pipelinesUri = vscode.Uri.file(path.join(REPO_ROOT, "test/complex/pipelines.yaml"));
      const exportersUri = vscode.Uri.file(path.join(REPO_ROOT, "test/complex/exporters.yaml"));

      await vscode.workspace.openTextDocument(exportersUri);
      const pipelinesDoc = await vscode.workspace.openTextDocument(pipelinesUri);
      await vscode.window.showTextDocument(pipelinesDoc);

      // `otlp/primary` is defined in exporters.yaml; find its ref in pipelines.yaml.
      const text = pipelinesDoc.getText();
      const refIdx = text.indexOf("otlp/primary");
      assert.ok(refIdx > 0, "expected `otlp/primary` reference in pipelines.yaml");
      const position = pipelinesDoc.positionAt(refIdx + 1);

      const defs = await waitFor(async () => {
        const result = (await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",
          pipelinesUri,
          position,
        )) as Array<vscode.Location | vscode.LocationLink>;
        return Array.isArray(result) && result.length > 0 ? result : undefined;
      });

      const targetUri =
        (defs[0] as vscode.Location).uri ?? (defs[0] as vscode.LocationLink).targetUri;
      assert.equal(
        targetUri.toString(),
        exportersUri.toString(),
        `expected jump into exporters.yaml, got ${targetUri.toString()}`,
      );
    });
  });
});
