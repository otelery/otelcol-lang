// Direct unit tests for src/server/hover.ts.
//
// The hover provider has five resolution branches (in priority order):
//   (1) per-key hover inside a component's config block (driven by the
//       component's JSON Schema's `properties` + `description`)
//   (2) component-ID definition hover (the `otlp:` line under `receivers:`)
//   (3) pipeline-ref hover → resolves cross-doc to the component def
//   (4) service.extensions ref hover
//   (5) cross-config extension ref hover (auth.authenticator, storage, …)
//
// Each test isolates one branch.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const { hover } = await import(resolve(root, "out/server/hover.js"));
const { loadComponents } = await import(resolve(root, "out/server/components.js"));
const { singletonSetModel } = await import(resolve(root, "out/server/set-model.js"));

const idx = loadComponents(resolve(root, "out", "server"));

function hoverAt(text, line, character, uri = "file:///x.yaml") {
  const model = singletonSetModel(uri, text);
  return hover(model, uri, idx, { line, character });
}

function mdValue(h) {
  return typeof h.contents === "string" ? h.contents : h.contents.value;
}

// ─── (2) component-ID definition hover ──────────────────────────────────

describe("hover: component-ID definitions", () => {
  it("hovering on a receiver definition returns metadata markdown", () => {
    // Cursor on the 'o' of `  otlp:` (line 1, char 2).
    const h = hoverAt("receivers:\n  otlp:\n", 1, 3);
    assert.ok(h, "expected hover result on receiver definition");
    const md = mdValue(h);
    assert.match(md, /receiver/i, "hover should identify it as a receiver");
    assert.match(md, /otlp/i, "hover should name the type");
    // For a known contrib component, signals should surface.
    assert.match(md, /Signals/, `expected 'Signals' line in hover; got: ${md.substring(0, 200)}`);
  });

  it("hovering on an exporter definition surfaces its display name", () => {
    const h = hoverAt("exporters:\n  debug:\n", 1, 3);
    assert.ok(h);
    const md = mdValue(h);
    assert.match(md, /exporter/i);
    assert.match(md, /debug/i);
  });

  it("hovering on an unreferenced receiver returns 'not referenced' note", () => {
    // Single-file config, otlp defined but no pipeline → 'not referenced'.
    const h = hoverAt("receivers:\n  otlp:\n", 1, 3);
    assert.ok(h);
    const md = mdValue(h);
    assert.match(
      md,
      /not referenced/i,
      `unreferenced receiver should be marked; got: ${md.substring(0, 200)}`,
    );
  });

  it("returns a range that covers the component-id token", () => {
    const h = hoverAt("receivers:\n  otlp:\n", 1, 3);
    assert.ok(h.range);
    assert.equal(h.range.start.line, 1);
    assert.equal(h.range.start.character, 2);
    // 'otlp' is 4 chars.
    assert.equal(h.range.end.character, 6);
  });
});

// ─── (3) pipeline-ref hover (resolves to component def) ─────────────────

describe("hover: pipeline-ref → component-def resolution", () => {
  const config = `receivers:
  otlp:
exporters:
  debug:
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
`;

  it("hovering on a pipeline ref resolves to the referenced receiver's metadata", () => {
    // Find the 'otlp' inside `receivers: [otlp]`.
    const lines = config.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("receivers: [otlp]"));
    const charIdx = lines[lineIdx].indexOf("otlp");
    const h = hoverAt(config, lineIdx, charIdx + 1);
    assert.ok(h, "expected hover on pipeline ref to resolve");
    const md = mdValue(h);
    assert.match(md, /receiver/i);
    assert.match(md, /otlp/i);
    // Now the receiver IS used in a pipeline, so 'Used in' should list it.
    assert.match(md, /Used in/, `expected 'Used in' section; got: ${md.substring(0, 200)}`);
    assert.match(md, /traces/);
  });

  it("hovering on a pipeline ref returns a range covering just the ref token", () => {
    const lines = config.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("[otlp]"));
    const charIdx = lines[lineIdx].indexOf("otlp");
    const h = hoverAt(config, lineIdx, charIdx + 1);
    assert.ok(h.range);
    assert.equal(h.range.start.line, lineIdx);
    assert.equal(h.range.start.character, charIdx);
    assert.equal(h.range.end.character, charIdx + 4); // 'otlp'
  });
});

// ─── (4) service.extensions hover ───────────────────────────────────────

describe("hover: service.extensions references", () => {
  const config = `extensions:
  health_check:
service:
  extensions: [health_check]
  pipelines: {}
`;

  it("hovering on a service.extensions ref resolves to the extension def", () => {
    const lines = config.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("[health_check]"));
    const charIdx = lines[lineIdx].indexOf("health_check");
    const h = hoverAt(config, lineIdx, charIdx + 1);
    assert.ok(h, "expected hover on service.extensions ref to resolve");
    const md = mdValue(h);
    assert.match(md, /extension/i);
    assert.match(md, /health_check/i);
  });
});

// ─── negative cases: null returns ───────────────────────────────────────

describe("hover: null cases", () => {
  it("hovering on whitespace / outside any component returns null", () => {
    // Position on the bare 'receivers:' line, in the colon — no component there.
    const h = hoverAt("receivers:\n  otlp:\n", 0, 10);
    assert.equal(h, null);
  });

  it("hovering on a pipeline ref that points to an undefined component returns null", () => {
    const config = `receivers:
  otlp:
exporters:
  debug:
service:
  pipelines:
    traces:
      receivers: [ghost]
      exporters: [debug]
`;
    const lines = config.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("[ghost]"));
    const charIdx = lines[lineIdx].indexOf("ghost");
    const h = hoverAt(config, lineIdx, charIdx + 1);
    assert.equal(h, null, "undefined ref should not resolve to a hover");
  });

  it("hover called on an unknown URI returns null", () => {
    const model = singletonSetModel("file:///real.yaml", "receivers:\n  otlp:\n");
    const h = hover(model, "file:///does-not-exist.yaml", idx, { line: 0, character: 0 });
    assert.equal(h, null);
  });

  it("hover at end-of-file (past last char) returns null", () => {
    const text = "receivers:\n  otlp:\n";
    const h = hoverAt(text, 99, 99);
    assert.equal(h, null);
  });
});

// ─── markdown content shape ─────────────────────────────────────────────

describe("hover: markdown content shape", () => {
  it("component hover uses MarkupKind.Markdown", () => {
    const h = hoverAt("receivers:\n  otlp:\n", 1, 3);
    assert.ok(h);
    assert.equal(typeof h.contents, "object");
    assert.equal(h.contents.kind, "markdown");
    assert.equal(typeof h.contents.value, "string");
    assert.ok(h.contents.value.length > 0);
  });

  it("component hover includes a bold class label (`**receiver**: \\`type\\``)", () => {
    const h = hoverAt("receivers:\n  otlp:\n", 1, 3);
    const md = mdValue(h);
    // First line is the bolded class+type.
    const firstLine = md.split("\n")[0];
    assert.match(firstLine, /\*\*receiver\*\*/);
    assert.match(firstLine, /`otlp`/);
  });
});
