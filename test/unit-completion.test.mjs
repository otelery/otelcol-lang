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

  it("known limitation: blank child line under a top-level map returns root-level suggestions", () => {
    // pathAtOffset on a blank indented line returns [], so the function falls
    // through to the root-level branch. This is the actual behaviour today.
    // A future enhancement could special-case blank lines to inherit the
    // parent map's context. Pinned here so any future change is visible.
    const items = complete("receivers:\n  \n", 1, 2);
    // Either: empty (parser couldn't decide) or top-level keys (segs.length === 0).
    if (items.length > 0) {
      const labels = items.map((i) => i.label);
      assert.ok(labels.includes("receivers"), `expected top-level keys, got: ${labels}`);
    }
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

// ─── irrelevant contexts: empty completion ──────────────────────────────

describe("completion: irrelevant contexts return empty", () => {
  it("deep inside a component's config block returns no suggestions", () => {
    const text = `receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
`;
    const lines = text.split("\n");
    const endpointLine = lines.findIndex((l) => l.includes("endpoint:"));
    const items = complete(text, endpointLine, lines[endpointLine].indexOf("endpoint"));
    assert.equal(items.length, 0);
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
