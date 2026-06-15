// Direct unit tests for src/server/completion.ts.
//
// The completion provider has three branches:
//   (1) cursor on a (partial) key inside one of the top-level component maps
//       → suggest known component types from the loaded distribution
//   (2) cursor inside service.pipelines.<sig>.{receivers,processors,exporters}
//       → suggest defined IDs from this set's components map
//   (3) cursor at the document root → suggest the top-level otelcol keys
//
// Important: the LSP fires completion at the byte offset the user typed at —
// so the cursor must be ON an existing key token (even a partial one),
// not on a blank line. A blank line under `receivers:` returns path = []
// because the YAML parser can't associate the blank with `receivers`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const { completion } = await import(resolve(root, "out/server/completion.js"));
const { loadComponents } = await import(resolve(root, "out/server/components.js"));
const { singletonSetModel } = await import(resolve(root, "out/server/set-model.js"));

const idx = loadComponents(resolve(root, "out", "server"));

function complete(text, line, character, uri = "file:///x.yaml") {
  const model = singletonSetModel(uri, text);
  return completion(model, uri, idx, { line, character });
}

// ─── (1) component-type completion inside top-level maps ────────────────
//
// All four tests position the cursor on an existing child key so that
// pathAtOffset returns the parent map's name.

describe("completion: component-type context", () => {
  it("suggests receiver types when cursor is on a key inside `receivers:`", () => {
    // Cursor on the `o` of `otlp` → pathAtOffset = ["receivers"].
    const items = complete("receivers:\n  otlp:\n", 1, 3);
    assert.ok(items.length > 0, "expected at least one suggestion");
    for (const item of items) {
      assert.match(item.detail || "", /^receiver/, `unexpected detail: ${item.detail}`);
    }
    assert.ok(
      items.some((i) => i.label === "otlp"),
      `expected 'otlp' among receiver suggestions; got: ${items.map((i) => i.label).slice(0, 10)}`,
    );
  });

  it("suggests exporter types when cursor is on a key inside `exporters:`", () => {
    const items = complete("exporters:\n  debug:\n", 1, 3);
    assert.ok(items.length > 0);
    for (const item of items) {
      assert.match(item.detail || "", /^exporter/);
    }
    assert.ok(items.some((i) => i.label === "debug"));
  });

  it("suggests processor types when cursor is on a key inside `processors:`", () => {
    const items = complete("processors:\n  batch:\n", 1, 3);
    assert.ok(items.length > 0);
    for (const item of items) {
      assert.match(item.detail || "", /^processor/);
    }
    assert.ok(items.some((i) => i.label === "batch"));
  });

  it("suggests extension types when cursor is on a key inside `extensions:`", () => {
    const items = complete("extensions:\n  health_check:\n", 1, 3);
    assert.ok(items.length > 0);
    for (const item of items) {
      assert.match(item.detail || "", /^extension/);
    }
  });

  it("blank child line under `receivers:` suggests component types (indent-aware)", () => {
    // Cursor sits at indent column 2 on a blank line directly under `receivers:`.
    // Resolution must fall back to the indent column so the path becomes
    // ["receivers"] and the component-type branch fires.
    const items = complete("receivers:\n  \n", 1, 2);
    assert.ok(items.length > 0, "expected receiver types to be suggested");
    for (const item of items) {
      assert.match(item.detail || "", /^receiver/, `unexpected detail: ${item.detail}`);
    }
    assert.ok(
      items.some((i) => i.label === "otlp"),
      `expected 'otlp' among receiver suggestions; got: ${items.map((i) => i.label).slice(0, 10)}`,
    );
  });
});

// ─── (1a') intellij/LSP4IJ shape: blank line + reported column 0 ───────

describe("completion: intellij-shaped blank-line position", () => {
  // IntelliJ via LSP4IJ frequently sends position.character = 0 on a blank
  // line after pressing Enter under a `key:`, even though the cursor is
  // visually indented. The resolver must still infer the surrounding
  // context from the preceding non-blank line.

  it("under `receivers:` with reported column 0 still suggests receiver types", () => {
    const items = complete("receivers:\n\n", 1, 0);
    assert.ok(items.length > 0, "expected receiver suggestions");
    for (const item of items) {
      assert.match(item.detail || "", /^receiver/, `unexpected detail: ${item.detail}`);
    }
    assert.ok(items.some((i) => i.label === "otlp"));
  });

  it("under `service.pipelines.<sig>:` with column 0 still suggests buckets", () => {
    const items = complete("service:\n  pipelines:\n    test:\n\n", 3, 0);
    const labels = items.map((i) => i.label);
    for (const bucket of ["receivers", "processors", "exporters"]) {
      assert.ok(labels.includes(bucket), `expected '${bucket}'; got ${labels}`);
    }
    for (const wrong of ["connectors", "extensions", "service"]) {
      assert.ok(!labels.includes(wrong), `unexpected '${wrong}' in pipeline body`);
    }
  });

  it("under a component instance with column 0 still suggests schema keys", () => {
    const items = complete("receivers:\n  otlp:\n\n", 2, 0);
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("protocols"), `expected 'protocols'; got ${labels.slice(0, 10)}`);
  });
});

// ─── (1b) pipeline-body context: bucket names ───────────────────────────

describe("completion: pipeline-body context", () => {
  it("blank line under `service.pipelines.<sig>:` suggests bucket names", () => {
    // service:
    //   pipelines:
    //     test:
    //       <cursor at column 6>
    const text = "service:\n  pipelines:\n    test:\n      \n";
    const items = complete(text, 3, 6);
    const labels = items.map((i) => i.label);
    for (const bucket of ["receivers", "processors", "exporters"]) {
      assert.ok(
        labels.includes(bucket),
        `expected '${bucket}' among pipeline-body suggestions; got: ${labels}`,
      );
    }
    // Pipeline bodies don't accept top-level-only keys; if these leak through
    // it means the resolver fell back to the root branch.
    for (const wrong of ["connectors", "extensions", "service"]) {
      assert.ok(
        !labels.includes(wrong),
        `did not expect '${wrong}' inside a pipeline body; got: ${labels}`,
      );
    }
  });

  it("blank line inside `service.pipelines.<sig>.receivers:` suggests defined ids", () => {
    const text =
      "receivers:\n  otlp:\n  hostmetrics:\nservice:\n  pipelines:\n    test:\n      receivers:\n        \n";
    // Cursor on the blank child line (line 7), column 8 → path resolves to
    // ["service","pipelines","test","receivers"], which is the existing
    // pipeline-ref branch.
    const items = complete(text, 7, 8);
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("otlp"), `expected 'otlp'; got: ${labels}`);
    assert.ok(labels.includes("hostmetrics"), `expected 'hostmetrics'; got: ${labels}`);
  });
});

// ─── (1c) schema-driven property completion ─────────────────────────────

describe("completion: schema-driven property keys", () => {
  it("blank line under a component instance suggests its schema property keys", () => {
    // receivers:
    //   otlp:
    //     <cursor at column 4>
    const text = "receivers:\n  otlp:\n    \n";
    const items = complete(text, 2, 4);
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.includes("protocols"),
      `expected 'protocols' in otlp receiver schema keys; got: ${labels.slice(0, 20)}`,
    );
  });

  it("blank line nested deeper walks the schema along the path", () => {
    // receivers:
    //   otlp:
    //     protocols:
    //       grpc:
    //         <cursor at column 8>
    const text = "receivers:\n  otlp:\n    protocols:\n      grpc:\n        \n";
    const items = complete(text, 4, 8);
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.includes("endpoint"),
      `expected 'endpoint' inside otlp grpc; got: ${labels.slice(0, 20)}`,
    );
  });
});

// ─── (2) pipeline-ref completion ────────────────────────────────────────

describe("completion: pipeline-ref context", () => {
  const config = `receivers:
  otlp:
  hostmetrics:
processors:
  batch:
exporters:
  debug:
  otlp/primary:
service:
  pipelines:
    traces:
      receivers:
        - x
`;

  it("inside service.pipelines.traces.receivers (block style) suggests DEFINED receiver IDs", () => {
    // Cursor on the 'x' after the dash → path = [service, pipelines, traces, receivers].
    const lines = config.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("- x"));
    const items = complete(config, lineIdx, lines[lineIdx].indexOf("x"));

    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("otlp"), `expected 'otlp' suggested; got: ${labels}`);
    assert.ok(labels.includes("hostmetrics"), `expected 'hostmetrics' suggested; got: ${labels}`);
    // Connectors are also valid pipeline refs (can be used as receiver or exporter).
    // No connectors in this fixture, so just assert the receivers showed up.
    assert.ok(
      !labels.includes("batch"),
      "processor 'batch' should not be suggested in receivers bucket",
    );
    assert.ok(
      !labels.includes("debug"),
      "exporter 'debug' should not be suggested in receivers bucket",
    );
  });

  it("inside service.pipelines.traces.exporters suggests DEFINED exporter IDs", () => {
    const cfg = `receivers:
  otlp:
exporters:
  debug:
  otlp/primary:
service:
  pipelines:
    traces:
      exporters:
        - x
`;
    const lines = cfg.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("- x"));
    const items = complete(cfg, lineIdx, lines[lineIdx].indexOf("x"));
    const labels = new Set(items.map((i) => i.label));
    assert.ok(labels.has("debug"));
    assert.ok(labels.has("otlp/primary"));
    assert.ok(!labels.has("otlp"), "receiver 'otlp' should not be suggested in exporters bucket");
  });

  it("flow-style brackets work the same as block style", () => {
    const cfg = `receivers:
  otlp:
exporters:
  debug:
service:
  pipelines:
    traces:
      receivers: [x]
      exporters: [debug]
`;
    const lines = cfg.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("[x]"));
    const items = complete(cfg, lineIdx, lines[lineIdx].indexOf("x"));
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("otlp"));
  });
});

// ─── (3) root-context: top-level otelcol keys ───────────────────────────

describe("completion: top-level keys", () => {
  it("empty document suggests the canonical otelcol top-level keys", () => {
    const items = complete("", 0, 0);
    const labels = items.map((i) => i.label);
    for (const key of [
      "receivers",
      "processors",
      "exporters",
      "connectors",
      "extensions",
      "service",
    ]) {
      assert.ok(labels.includes(key), `expected top-level key '${key}'; got: ${labels}`);
    }
  });

  it("top-level keys have kind=Module (9)", () => {
    const items = complete("", 0, 0);
    for (const item of items) {
      assert.equal(
        item.kind,
        9,
        `top-level item '${item.label}' should be kind=Module (9), got ${item.kind}`,
      );
    }
  });
});

// ─── completion item metadata (detail + documentation) ─────────────────

describe("completion: schema-property item metadata", () => {
  it("schema property items carry a `detail` summarising the type", () => {
    // receivers.otlp.protocols.grpc.endpoint is a string field; siblings
    // include `endpoint` itself when completing inside `grpc`.
    const text = "receivers:\n  otlp:\n    protocols:\n      grpc:\n        \n";
    const items = complete(text, 4, 8);
    const endpoint = items.find((i) => i.label === "endpoint");
    assert.ok(endpoint, `expected 'endpoint' suggestion; got ${items.map((i) => i.label)}`);
    assert.ok(
      endpoint.detail && endpoint.detail.length > 0,
      `endpoint item should have a non-empty detail; got ${JSON.stringify(endpoint.detail)}`,
    );
  });

  it("schema property items carry markdown documentation built from the schema", () => {
    const text = "receivers:\n  otlp:\n    \n";
    const items = complete(text, 2, 4);
    const protocols = items.find((i) => i.label === "protocols");
    assert.ok(protocols);
    assert.ok(
      protocols.documentation && typeof protocols.documentation === "object",
      "documentation should be a MarkupContent object",
    );
    assert.equal(protocols.documentation.kind, "markdown");
    assert.ok(
      protocols.documentation.value.includes("**`protocols`**"),
      `documentation should lead with the bolded key; got: ${protocols.documentation.value.slice(0, 120)}`,
    );
  });
});

describe("completion: pipeline-ref item metadata", () => {
  it("pipeline-ref items expose the resolved component type in `detail`", () => {
    const cfg = `receivers:
  otlp/primary:
exporters:
  debug:
service:
  pipelines:
    traces:
      receivers:
        - x
`;
    const lines = cfg.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("- x"));
    const items = complete(cfg, lineIdx, lines[lineIdx].indexOf("x"));
    const otlp = items.find((i) => i.label === "otlp/primary");
    assert.ok(otlp, `expected otlp/primary in suggestions; got ${items.map((i) => i.label)}`);
    assert.match(
      otlp.detail || "",
      /receiver.*type otlp/,
      `expected receiver+type metadata; got ${otlp.detail}`,
    );
  });
});

describe("completion: pipeline-body item metadata", () => {
  it("bucket suggestions carry a `detail` description", () => {
    const text = "service:\n  pipelines:\n    test:\n      \n";
    const items = complete(text, 3, 6);
    for (const bucket of ["receivers", "processors", "exporters"]) {
      const item = items.find((i) => i.label === bucket);
      assert.ok(item, `missing bucket '${bucket}'`);
      assert.ok(
        item.detail && item.detail.length > 0,
        `bucket '${bucket}' should have a detail string`,
      );
    }
  });
});

describe("completion: top-level item metadata", () => {
  it("top-level keys carry a `detail` describing each section", () => {
    const items = complete("", 0, 0);
    for (const key of [
      "receivers",
      "processors",
      "exporters",
      "connectors",
      "extensions",
      "service",
    ]) {
      const item = items.find((i) => i.label === key);
      assert.ok(item, `missing top-level key '${key}'`);
      assert.ok(
        item.detail && item.detail.length > 0,
        `top-level '${key}' should have a detail string`,
      );
    }
  });
});

// ─── snippet insertion ─────────────────────────────────────────────────

describe("completion: snippet insertion", () => {
  it("object-typed property emits a continuation indented by one INDENT_UNIT (client re-applies line indent)", () => {
    // protocols is an object property of the otlp receiver. Cursor on a
    // 4-space-indented line. Per LSP spec, both `asIs` and
    // `adjustIndentation` modes prepend the cursor line's indent to lines
    // *after the first* in the inserted text — so the snippet body itself
    // should carry only the *relative* extra indent (INDENT_UNIT = 2),
    // not the full cumulative path (which would double-indent).
    //
    //   line indent (4) + snippet continuation indent (2)
    //                     ↳ rendered: 6 spaces before child cursor
    const text = "receivers:\n  otlp:\n    \n";
    const items = complete(text, 2, 4);
    const protocols = items.find((i) => i.label === "protocols");
    assert.ok(protocols);
    assert.equal(protocols.insertTextFormat, 2, "object property should insert as a snippet");
    assert.equal(protocols.insertTextMode, 1, "should be InsertTextMode.asIs");
    assert.equal(protocols.insertText, "protocols:\n  $0");
  });

  it("array-typed property emits a continuation indented by one INDENT_UNIT (client re-applies line indent)", () => {
    // batch processor's `metadata_keys` is an array. Cursor on a 4-space-
    // indented line. Snippet body carries 2 spaces (relative INDENT_UNIT)
    // before the dash; the client then prepends the cursor line's 4-space
    // indent → dash lands at column 6 (one level deeper than the key).
    const text = "processors:\n  batch:\n    \n";
    const items = complete(text, 2, 4);
    const metadataKeys = items.find((i) => i.label === "metadata_keys");
    assert.ok(metadataKeys, `missing metadata_keys; got ${items.map((i) => i.label)}`);
    assert.equal(metadataKeys.insertTextFormat, 2);
    assert.equal(metadataKeys.insertTextMode, 1, "should be InsertTextMode.asIs");
    assert.equal(metadataKeys.insertText, "metadata_keys:\n  - $0");
  });

  it("textEdit range covers only the typed prefix — leaves the leading indent untouched", () => {
    // LSP4IJ otherwise scans the replacement range back to column 0,
    // eating the line's indent and landing inserted keys at col 0.
    // Cursor on `    met` (4-space indent + 3-char prefix at chars 4..7).
    const text = "processors:\n  batch:\n    met\n";
    const items = complete(text, 2, 7);
    const metadataKeys = items.find((i) => i.label === "metadata_keys");
    assert.ok(metadataKeys, `missing metadata_keys; got ${items.map((i) => i.label)}`);
    assert.ok(metadataKeys.textEdit, "should ship a textEdit so the client can't widen the range");
    assert.deepEqual(metadataKeys.textEdit.range, {
      start: { line: 2, character: 4 },
      end: { line: 2, character: 7 },
    });
  });

  it("scalar property with a schema `default` pre-fills it as a placeholder", () => {
    // batch processor's `send_batch_size` carries `"default": 8192` in the schema.
    const text = "processors:\n  batch:\n    \n";
    const items = complete(text, 2, 4);
    const sendBatch = items.find((i) => i.label === "send_batch_size");
    assert.ok(sendBatch, `missing send_batch_size; got ${items.map((i) => i.label)}`);
    assert.equal(sendBatch.insertTextFormat, 2);
    assert.equal(
      sendBatch.insertText,
      "send_batch_size: ${1:8192}",
      `expected default placeholder; got ${JSON.stringify(sendBatch.insertText)}`,
    );
  });

  it("scalar property inserts `key: $0` as a snippet", () => {
    // endpoint inside grpc is a scalar (string).
    const text = "receivers:\n  otlp:\n    protocols:\n      grpc:\n        \n";
    const items = complete(text, 4, 8);
    const endpoint = items.find((i) => i.label === "endpoint");
    assert.ok(endpoint);
    assert.equal(endpoint.insertTextFormat, 2);
    assert.equal(endpoint.insertText, "endpoint: $0");
  });

  it("filters out sibling keys already defined under the cursor's parent mapping", () => {
    // YAML mappings are unique-key — re-inserting an existing sibling key is
    // a duplicate-key error, so the completion shouldn't surface keys that
    // are already present at the same indent level.
    const text =
      "processors:\n" +
      "  batch:\n" +
      "    send_batch_size: 1024\n" +
      "    timeout: 5s\n" +
      "    \n";
    const items = complete(text, 4, 4);
    const labels = items.map((i) => i.label);
    assert.ok(
      !labels.includes("send_batch_size"),
      `send_batch_size is already set on line 2 — must not be suggested; got ${labels.join(",")}`,
    );
    assert.ok(
      !labels.includes("timeout"),
      `timeout is already set on line 3 — must not be suggested; got ${labels.join(",")}`,
    );
    assert.ok(
      labels.includes("metadata_keys"),
      "metadata_keys is not yet defined — should still surface",
    );
  });

  it("suggests sibling keys on a blank line following a populated nested array", () => {
    // Regression: the blank-line indent heuristic in pathAtPosition would
    // pull `cursorIndent` up to 6 (matching the array items `      - …`),
    // resolving the cursor to ["processors","batch","metadata_keys"] — an
    // array, no properties → empty completions. The cursor is clearly at
    // col 4 (sibling of metadata_keys), and that's what its visible
    // whitespace says; the heuristic must not over-raise.
    const text =
      "processors:\n" +
      "  batch:\n" +
      "    send_batch_size: 1024\n" +
      "    timeout: 5s\n" +
      "    metadata_keys:\n" +
      "      - test\n" +
      "      - ff\n" +
      "    \n" +
      "    \n";
    const items = complete(text, 8, 4);
    const labels = items.map((i) => i.label);
    assert.ok(items.length > 0, `expected completions; got none. Path resolution likely broken.`);
    assert.ok(
      !labels.includes("metadata_keys"),
      "metadata_keys is already set on line 4 — must not be suggested",
    );
    assert.ok(
      labels.includes("metadata_cardinality_limit"),
      `expected unset batch property among completions; got: ${labels.join(",")}`,
    );
  });
});

// ─── enum-value completion on `:` ──────────────────────────────────────

describe("completion: enum values after `:`", () => {
  it("after `compression: ` on an exporter, suggests the enum values", () => {
    // otlp exporter `compression` is a string enum: "", "none", "gzip", "snappy", "zstd", ...
    const text = "exporters:\n  otlp:\n    compression: \n";
    const items = complete(text, 2, 17); // cursor right after the space
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.includes("gzip"),
      `expected 'gzip' among enum value suggestions; got: ${labels.slice(0, 20)}`,
    );
    for (const v of ["none", "zstd", "snappy"]) {
      assert.ok(labels.includes(v), `expected '${v}' among enum values; got: ${labels}`);
    }
    // Should NOT be schema-property keys.
    assert.ok(
      !labels.includes("endpoint"),
      "value-position completion must not leak property keys",
    );
  });
});

// ─── detail fallback for enum-bearing fields ───────────────────────────

describe("completion: detail surfaces enum hint", () => {
  it("enum-bearing scalar property mentions enum values in `detail`", () => {
    const text = "exporters:\n  otlp:\n    \n";
    const items = complete(text, 2, 4);
    const compression = items.find((i) => i.label === "compression");
    assert.ok(compression);
    // Detail should reference one of the enum values or contain "enum".
    assert.match(
      compression.detail || "",
      /gzip|enum/i,
      `expected enum hint in detail; got: ${compression.detail}`,
    );
  });
});

// ─── irrelevant contexts: empty completion ──────────────────────────────

describe("completion: irrelevant contexts return empty", () => {
  it("cursor on a known key inside a component config now suggests sibling schema keys", () => {
    // Schema-driven branch: the cursor on `endpoint:` resolves to grpc's
    // properties, so completing here lists grpc's siblings (endpoint, tls, ...).
    const text = `receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
`;
    const lines = text.split("\n");
    const endpointLine = lines.findIndex((l) => l.includes("endpoint:"));
    const items = complete(text, endpointLine, lines[endpointLine].indexOf("endpoint"));
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("endpoint"), `expected 'endpoint' in grpc keys; got: ${labels}`);
  });

  it("inside service.pipelines.<sig>.connectors (not a known bucket) returns no suggestions", () => {
    // `connectors` is not one of receivers/processors/exporters per the
    // PARENT_TO_CLASS lookup inside the pipeline-ref branch.
    const text = `service:
  pipelines:
    traces:
      connectors:
        - x
`;
    const lines = text.split("\n");
    const dashLine = lines.findIndex((l) => l.includes("- x"));
    const items = complete(text, dashLine, lines[dashLine].indexOf("x"));
    assert.equal(
      items.length,
      0,
      "no completion expected for unknown pipeline bucket 'connectors'",
    );
  });

  it("unknown URI passed to completion returns empty", () => {
    const model = singletonSetModel("file:///real.yaml", "receivers:\n  otlp:\n");
    const items = completion(model, "file:///nonexistent.yaml", idx, { line: 0, character: 0 });
    assert.deepEqual(items, []);
  });
});

// ─── completion item shape ──────────────────────────────────────────────

describe("completion: item shape", () => {
  it("component-type items carry kind=Class (7) and a non-empty detail", () => {
    const items = complete("receivers:\n  otlp:\n", 1, 3);
    assert.ok(items.length > 0);
    for (const item of items) {
      assert.equal(item.kind, 7, `item ${item.label} has wrong kind (${item.kind})`);
      assert.ok(item.detail && item.detail.length > 0);
    }
  });

  it("pipeline-ref items carry kind=Reference (18)", () => {
    const text = `receivers:
  otlp:
exporters:
  debug:
service:
  pipelines:
    traces:
      receivers:
        - x
      exporters: [debug]
`;
    const lines = text.split("\n");
    const dashLine = lines.findIndex((l) => l.includes("- x"));
    const items = complete(text, dashLine, lines[dashLine].indexOf("x"));
    assert.ok(items.length > 0);
    for (const item of items) {
      assert.equal(item.kind, 18, `pipeline-ref item ${item.label} has wrong kind (${item.kind})`);
    }
  });
});
