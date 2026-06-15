import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "otelery.opentelemetry-collector-config";

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

// Open a scratch document inside the test workspace with the given filename
// + initial text. Must live in the workspace (not /tmp/) so the otelcol
// language client attaches — VS Code only routes LSP traffic for files
// inside the open workspace folder. Caller passes a unique name; the file
// is unlinked in afterEach via the scratchFiles array.
const scratchFiles: string[] = [];
async function openScratch(name: string, text: string): Promise<vscode.TextEditor> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(wsFolder, "test workspace must be open");
  const file = path.join(wsFolder.uri.fsPath, name);
  fs.writeFileSync(file, text, "utf8");
  scratchFiles.push(file);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(doc);
  // Let the language client attach + parse the doc.
  await new Promise((r) => setTimeout(r, 300));
  return editor;
}

// Fetch the labels at a cursor position, waiting until at least one item
// arrives (LSP responses are async).
async function completionLabels(uri: vscode.Uri, position: vscode.Position): Promise<string[]> {
  const result = await waitFor(
    async () => {
      const r = (await vscode.commands.executeCommand(
        "vscode.executeCompletionItemProvider",
        uri,
        position,
      )) as vscode.CompletionList;
      return r && r.items && r.items.length > 0 ? r : undefined;
    },
    { timeoutMs: 10000, intervalMs: 200 },
  );
  return result.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
}

// Apply the completion item with the given label by:
//   1. fetching items via the LSP-backed provider,
//   2. deleting the range carried by the item's textEdit (or the
//      implicit-prefix word range if none),
//   3. inserting the snippet at the cursor.
// This mirrors what VS Code does internally when the user accepts an
// item with the keyboard. Lets us assert the post-acceptance buffer.
async function applyCompletion(
  editor: vscode.TextEditor,
  position: vscode.Position,
  label: string,
): Promise<void> {
  const result = await waitFor(
    async () => {
      const r = (await vscode.commands.executeCommand(
        "vscode.executeCompletionItemProvider",
        editor.document.uri,
        position,
      )) as vscode.CompletionList;
      return r && r.items && r.items.length > 0 ? r : undefined;
    },
    { timeoutMs: 10000, intervalMs: 200 },
  );
  const item = result.items.find((i) => {
    const l = typeof i.label === "string" ? i.label : i.label.label;
    return l === label;
  });
  assert.ok(item, `no completion item with label '${label}'`);
  const range =
    (item.range as vscode.Range | undefined) ??
    (item.range && "replacing" in (item.range as any)
      ? (item.range as any).replacing
      : undefined) ??
    editor.document.getWordRangeAtPosition(position) ??
    new vscode.Range(position, position);
  await editor.edit((eb) => eb.delete(range));
  const snippet =
    item.insertText instanceof vscode.SnippetString
      ? item.insertText
      : new vscode.SnippetString(typeof item.insertText === "string" ? item.insertText : label);
  await editor.insertSnippet(snippet);
}

const visualiseWhitespace = (s: string) => s.replace(/ /g, "·").replace(/\n/g, "↵\n");

function assertBufferEquals(actual: string, expected: string): void {
  if (actual === expected) return;
  assert.fail(
    `buffer mismatch\n--- expected ---\n${visualiseWhitespace(expected)}\n--- actual ---\n${visualiseWhitespace(actual)}\n`,
  );
}

describe("opentelemetry-collector-config extension", () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found in Extension Host`);
    await ext.activate();
  });

  afterEach(async () => {
    while (scratchFiles.length > 0) {
      const f = scratchFiles.pop()!;
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
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

  describe("completion provider", () => {
    it("suggests defined receiver IDs inside service.pipelines.<sig>.receivers", async () => {
      const fixturePath = path.resolve(__dirname, "../../../test/simple/otelcol-config.yaml");
      const uri = vscode.Uri.file(fixturePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      // Find the `traces:` pipeline's `receivers: [otlp]` line; the existing
      // 'otlp' token is a valid cursor position for completion.
      const text = doc.getText();
      const servicePipelines = text.indexOf("pipelines:");
      assert.ok(servicePipelines > 0, "fixture must contain service.pipelines");
      const receiversIdx = text.indexOf("receivers: [", servicePipelines);
      assert.ok(receiversIdx > 0, "fixture must contain a pipeline receivers list");
      const otlpRefIdx = text.indexOf("otlp", receiversIdx);
      const position = doc.positionAt(otlpRefIdx + 1);

      const result = await waitFor(
        async () => {
          const r = (await vscode.commands.executeCommand(
            "vscode.executeCompletionItemProvider",
            uri,
            position,
          )) as vscode.CompletionList;
          return r && r.items && r.items.length > 0 ? r : undefined;
        },
        { timeoutMs: 10000, intervalMs: 200 },
      );

      const labels = result.items
        .map((i) => i.label)
        .map((l) => (typeof l === "string" ? l : l.label));
      assert.ok(
        labels.includes("otlp"),
        `expected 'otlp' among completion items; got: ${labels.slice(0, 15).join(", ")}`,
      );
    });

    // The next four tests defend post-acceptance buffer state — they apply
    // the LSP CompletionItem to the document and assert resulting text.
    // Unit tests in test/unit-completion.test.mjs validate the LSP item
    // shape; these guard the *client-side application* (snippet expansion,
    // textEdit range honored, sibling filtering visible in the picker).
    // Mirrored 1:1 in editors/jetbrains/.../OtelcolCompletionTest.kt.

    // 1. Multi-line snippet indent — array property under a 4-space-indented
    //    blank line. `metadata_keys:` must land at col 4; `- ` at col 6.
    it("array property indents continuation line correctly post-acceptance", async () => {
      const text = "processors:\n  batch:\n    \n";
      const editor = await openScratch("indent-array.otelcol.yaml", text);
      const pos = new vscode.Position(2, 4);
      editor.selection = new vscode.Selection(pos, pos);
      await applyCompletion(editor, pos, "metadata_keys");
      assertBufferEquals(
        editor.document.getText(),
        "processors:\n  batch:\n    metadata_keys:\n      - \n",
      );
    });

    // 2. textEdit range pinning — typing `met` on a 4-space-indented line
    //    and accepting `metadata_keys` must NOT eat the leading indent.
    it("textEdit range preserves the leading indent post-acceptance", async () => {
      const text = "processors:\n  batch:\n    met\n";
      const editor = await openScratch("indent-prefix.otelcol.yaml", text);
      const pos = new vscode.Position(2, 7); // end of `met`
      editor.selection = new vscode.Selection(pos, pos);
      await applyCompletion(editor, pos, "metadata_keys");
      assertBufferEquals(
        editor.document.getText(),
        "processors:\n  batch:\n    metadata_keys:\n      - \n",
      );
    });

    // 3. Sibling-key filtering — keys already present in the mapping aren't
    //    re-suggested (would otherwise create a YAML duplicate-key error).
    it("filters out sibling keys already present in the mapping", async () => {
      const text = "processors:\n  batch:\n    send_batch_size: 1024\n    timeout: 5s\n    \n";
      const editor = await openScratch("indent-siblings.otelcol.yaml", text);
      const pos = new vscode.Position(4, 4);
      editor.selection = new vscode.Selection(pos, pos);
      const labels = await completionLabels(editor.document.uri, pos);
      assert.ok(
        !labels.includes("send_batch_size"),
        `send_batch_size already set on line 2 — must not be suggested; got: ${labels.join(",")}`,
      );
      assert.ok(
        !labels.includes("timeout"),
        `timeout already set on line 3 — must not be suggested; got: ${labels.join(",")}`,
      );
      assert.ok(
        labels.includes("metadata_keys"),
        `metadata_keys not yet defined — should still surface; got: ${labels.join(",")}`,
      );
    });

    // 4. keyOnLine carve-out — cursor parked on an existing key line still
    //    surfaces that key, so re-editing / replacing it works.
    it("re-suggests the key on the cursor's own line", async () => {
      const text =
        "receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317\n";
      const editor = await openScratch("indent-keyonline.otelcol.yaml", text);
      // cursor parked inside "endpoint" itself (line 4, between `end` and `point`)
      const pos = new vscode.Position(4, 11);
      editor.selection = new vscode.Selection(pos, pos);
      const labels = await completionLabels(editor.document.uri, pos);
      assert.ok(
        labels.includes("endpoint"),
        `cursor is on 'endpoint:' itself — must still appear; got: ${labels.slice(0, 15).join(",")}`,
      );
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
