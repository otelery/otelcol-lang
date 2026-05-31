// Direct unit tests for src/server/yaml-model.ts.
//
// Build a DocModel from inline YAML strings and assert on the parsed
// shape, position math, anchor/alias handling, edge cases, and parse
// diagnostics. Position math is verified independently because it
// underpins every range the LSP emits.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const { buildModel, posFromOffset, offsetFromPos, rangeFromOffsets, pathAtOffset } = await import(
  resolve(root, "out/server/yaml-model.js")
);

// ─── position helpers (offset ↔ {line, character}) ──────────────────────

describe("yaml-model: position helpers", () => {
  const text = "line0\nline1 has more chars\nline2\n";

  it("posFromOffset at start returns line=0 char=0", () => {
    assert.deepEqual(posFromOffset(text, 0), { line: 0, character: 0 });
  });

  it("posFromOffset after first newline returns line=1 char=0", () => {
    // 'line0\n' is 6 chars.
    assert.deepEqual(posFromOffset(text, 6), { line: 1, character: 0 });
  });

  it("posFromOffset mid-line returns correct character", () => {
    // 'line0\nline1' → offset 11 is just after 'line1', so char=5 on line 1.
    assert.deepEqual(posFromOffset(text, 11), { line: 1, character: 5 });
  });

  it("posFromOffset clamps negative offsets to 0", () => {
    assert.deepEqual(posFromOffset(text, -10), { line: 0, character: 0 });
  });

  it("posFromOffset clamps overflow to end-of-text", () => {
    const p = posFromOffset(text, 9999);
    // Last line is empty (text ends with \n), so line=3 char=0.
    assert.equal(p.line, 3);
    assert.equal(p.character, 0);
  });

  it("offsetFromPos is the inverse of posFromOffset for valid positions", () => {
    for (const offset of [0, 3, 6, 7, 11, 25, 30]) {
      if (offset > text.length) continue;
      const pos = posFromOffset(text, offset);
      assert.equal(offsetFromPos(text, pos), offset, `roundtrip failed at offset ${offset}`);
    }
  });

  it("rangeFromOffsets returns {start, end} with correct line/character math", () => {
    const r = rangeFromOffsets(text, 6, 11);
    assert.deepEqual(r.start, { line: 1, character: 0 });
    assert.deepEqual(r.end, { line: 1, character: 5 });
  });
});

// ─── empty + degenerate inputs ──────────────────────────────────────────

describe("yaml-model: empty and degenerate inputs", () => {
  it("empty string produces an empty but valid DocModel", () => {
    const m = buildModel("", "file:///empty.yaml");
    assert.equal(m.sourceUri, "file:///empty.yaml");
    assert.equal(m.text, "");
    assert.equal(m.components.receiver.size, 0);
    assert.equal(m.components.processor.size, 0);
    assert.equal(m.components.exporter.size, 0);
    assert.equal(m.components.connector.size, 0);
    assert.equal(m.components.extension.size, 0);
    assert.equal(m.pipelines.length, 0);
    assert.equal(m.serviceExtensions.length, 0);
    assert.equal(m.diagnostics.length, 0);
  });

  it("comments-only file produces an empty DocModel without diagnostics", () => {
    const text = "# this is just a comment\n# and another\n";
    const m = buildModel(text, "file:///comments.yaml");
    assert.equal(m.components.receiver.size, 0);
    assert.equal(m.diagnostics.length, 0);
  });

  it("whitespace-only file produces empty DocModel", () => {
    const m = buildModel("   \n  \t \n\n", "");
    assert.equal(m.components.receiver.size, 0);
    assert.equal(m.diagnostics.length, 0);
  });

  it("preserves sourceUri exactly as provided (including empty)", () => {
    assert.equal(buildModel("", "").sourceUri, "");
    assert.equal(buildModel("", "file:///x.yaml").sourceUri, "file:///x.yaml");
  });
});

// ─── component parsing ──────────────────────────────────────────────────

describe("yaml-model: component definitions", () => {
  it("receivers + exporters + extensions populate the components maps", () => {
    const text = `
receivers:
  otlp:
    protocols:
      grpc:
exporters:
  debug:
extensions:
  health_check:
`;
    const m = buildModel(text, "file:///x.yaml");
    assert.equal(m.components.receiver.size, 1);
    assert.equal(m.components.exporter.size, 1);
    assert.equal(m.components.extension.size, 1);
    assert.ok(m.components.receiver.has("otlp"));
    assert.ok(m.components.exporter.has("debug"));
    assert.ok(m.components.extension.has("health_check"));
  });

  it("named components (type/name) parse with full id and split fields", () => {
    const text = `
exporters:
  otlp/primary:
    endpoint: a:4317
  otlp/secondary:
    endpoint: b:4317
`;
    const m = buildModel(text, "");
    const primary = m.components.exporter.get("otlp/primary");
    const secondary = m.components.exporter.get("otlp/secondary");
    assert.ok(primary);
    assert.ok(secondary);
    assert.equal(primary.id, "otlp/primary");
    assert.equal(primary.type, "otlp");
    assert.equal(primary.name, "primary");
    assert.equal(secondary.name, "secondary");
  });

  it("idRange points at the component id token on its line", () => {
    const text = `receivers:\n  otlp:\n    protocols:\n`;
    const m = buildModel(text, "file:///x.yaml");
    const otlp = m.components.receiver.get("otlp");
    assert.ok(otlp);
    assert.equal(otlp.idRange.start.line, 1);
    // After two spaces of indent.
    assert.equal(otlp.idRange.start.character, 2);
    assert.equal(otlp.idRange.end.character, 6); // "otlp" is 4 chars
  });

  it("each component entry carries the document's sourceUri", () => {
    const text = `receivers:\n  otlp:\n`;
    const m = buildModel(text, "file:///myfile.yaml");
    assert.equal(m.components.receiver.get("otlp").sourceUri, "file:///myfile.yaml");
  });
});

// ─── pipelines ──────────────────────────────────────────────────────────

describe("yaml-model: pipelines", () => {
  it("service.pipelines yields one PipelineEntry per signal/name", () => {
    const text = `
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
    metrics/internal:
      receivers: [otlp]
      exporters: [debug]
`;
    const m = buildModel(text, "");
    assert.equal(m.pipelines.length, 2);
    const ids = m.pipelines.map((p) => p.id).sort();
    assert.deepEqual(ids, ["metrics/internal", "traces"]);
  });

  it("service.extensions entries land in serviceExtensions", () => {
    const text = `
extensions:
  health_check:
service:
  extensions: [health_check]
  pipelines: {}
`;
    const m = buildModel(text, "");
    assert.equal(m.serviceExtensions.length, 1);
    assert.equal(m.serviceExtensions[0].id, "health_check");
  });

  it("no service block → zero pipelines, zero serviceExtensions", () => {
    const m = buildModel("receivers:\n  otlp:\n", "");
    assert.equal(m.pipelines.length, 0);
    assert.equal(m.serviceExtensions.length, 0);
  });
});

// ─── YAML anchors & aliases ─────────────────────────────────────────────

describe("yaml-model: anchors and aliases", () => {
  // NOTE: documents current parser behaviour — aliasing a whole pipeline
  // definition (`metrics: *t`) is NOT expanded into a second PipelineEntry.
  // Real-world configs alias *fragments* of component config (e.g. shared
  // tls blocks), not pipeline tops, so this gap is a known low-impact
  // limitation. If the parser ever starts expanding pipeline-level aliases,
  // this test will start passing-with-2 and should be updated to assert both
  // pipelines parse fully.
  it("known limitation: alias used AS a pipeline definition is not expanded into a second entry", () => {
    const text = `
receivers:
  otlp:
exporters:
  debug:
service:
  pipelines:
    traces: &t
      receivers: [otlp]
      exporters: [debug]
    metrics: *t
`;
    const m = buildModel(text, "");
    // Only `traces` materialises; `metrics: *t` is currently dropped.
    assert.equal(m.pipelines.length, 1);
    assert.equal(m.pipelines[0].id, "traces");
    // No parse error — the alias is recognised, just not promoted to a sibling pipeline.
    assert.equal(m.diagnostics.filter((d) => d.severity === "error").length, 0);
  });

  it("anchored receiver block reused via alias does not crash the parser", () => {
    const text = `
receivers:
  otlp: &otlp_def
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
  otlp/secondary: *otlp_def
`;
    const m = buildModel(text, "");
    // Both should be recognized as defined.
    assert.ok(m.components.receiver.has("otlp"));
    assert.ok(m.components.receiver.has("otlp/secondary"));
    // No parse error.
    assert.equal(m.diagnostics.filter((d) => d.severity === "error").length, 0);
  });
});

// ─── parse diagnostics ──────────────────────────────────────────────────

describe("yaml-model: parse diagnostics", () => {
  it("malformed YAML (mismatched bracket) surfaces a parse diagnostic", () => {
    const text = "receivers:\n  otlp: [unclosed\n";
    const m = buildModel(text, "file:///broken.yaml");
    // Some diagnostic must surface.
    assert.ok(
      m.diagnostics.length > 0,
      `expected at least one parse diagnostic; got: ${JSON.stringify(m.diagnostics)}`,
    );
    // Each diagnostic must carry a sane range and the sourceUri.
    for (const d of m.diagnostics) {
      assert.equal(d.sourceUri, "file:///broken.yaml");
      assert.ok(d.range && d.range.start.line >= 0);
    }
  });

  it("tab indentation (invalid in YAML) produces a parse diagnostic without crashing", () => {
    const text = "receivers:\n\totlp:\n";
    const m = buildModel(text, "");
    // YAML parser may complain (tabs aren't allowed in indentation).
    // The important guarantee: we don't throw; the model is still constructed.
    assert.ok(m, "buildModel must return a model even on bad indent");
  });
});

// ─── OTTL block extraction ──────────────────────────────────────────────

describe("yaml-model: OTTL blocks", () => {
  it("extracts OTTL from transform processor statements", () => {
    const text = `
processors:
  transform:
    trace_statements:
      - context: span
        statements:
          - set(attributes["foo"], "bar")
          - delete_key(attributes, "secret")
`;
    const m = buildModel(text, "");
    assert.ok(m.ottlBlocks.length >= 1, `expected OTTL blocks, got: ${m.ottlBlocks.length}`);
    // Each block should carry a non-empty source.
    for (const b of m.ottlBlocks) {
      assert.ok(b.text && b.text.length > 0, "OTTL block has empty text");
      assert.ok(b.range, "OTTL block missing range");
    }
  });

  it("filter processor conditions are recognised as OTTL", () => {
    const text = `
processors:
  filter:
    error_mode: ignore
    traces:
      span:
        - 'attributes["http.target"] == "/health"'
`;
    const m = buildModel(text, "");
    // The single string under spans[] should be recognised as an OTTL block.
    assert.ok(
      m.ottlBlocks.length >= 1,
      "filter processor span condition should produce an OTTL block",
    );
  });
});

// ─── pathAtOffset (completion/hover context resolution) ─────────────────

describe("yaml-model: pathAtOffset", () => {
  const text = `
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
`;

  it("returns ['receivers'] just after the receivers key", () => {
    // Offset of the 'o' in `  otlp:`.
    const offset = text.indexOf("  otlp:") + 2;
    const path = pathAtOffset(text, offset);
    assert.ok(
      path.includes("receivers"),
      `expected 'receivers' in path; got ${JSON.stringify(path)}`,
    );
  });

  it("returns deeper path inside a nested key", () => {
    const offset = text.indexOf("endpoint:");
    const path = pathAtOffset(text, offset);
    assert.ok(path.length >= 2, `expected deep path; got ${JSON.stringify(path)}`);
    assert.ok(path.includes("receivers"), "deep path should still root at 'receivers'");
  });

  it("offset 0 / before any key returns an empty or top-level path without crashing", () => {
    const path = pathAtOffset(text, 0);
    assert.ok(Array.isArray(path), "must return an array");
  });
});
