// Direct tests of the shared sniffer (`src/common/yaml-sniff.ts`).
// `test/run-tests.mjs` already exercises looksLikeOtelcol via fixtures; this
// file covers each rule (1–5) in isolation with disposable temp dirs so
// regressions in any single rule fail loudly with a localised name.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const { looksLikeOtelcol } = await import(resolve(root, "out/common/yaml-sniff.js"));

function scratch() {
  return mkdtempSync(join(tmpdir(), "otelcol-sniff-"));
}

describe("looksLikeOtelcol — rule 1: directive marker", () => {
  it("matches on a first-line `# otelcol-configset:` directive", () => {
    const dir = scratch();
    try {
      const f = join(dir, "plain.yaml");
      writeFileSync(f, "# otelcol-configset: pipelines.yaml\nkey: value\n");
      assert.equal(looksLikeOtelcol("# otelcol-configset: pipelines.yaml\nkey: value\n", f), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches even without an fsPath (unsaved buffer)", () => {
    assert.equal(looksLikeOtelcol("# otelcol-configset: a.yaml\nfoo: 1\n", null), true);
  });
});

describe("looksLikeOtelcol — rule 2: sidecar filename", () => {
  it("matches when basename is otelcol-configset.yaml regardless of content", () => {
    const dir = scratch();
    try {
      const f = join(dir, "otelcol-configset.yaml");
      writeFileSync(f, "anything: at: all\n");
      assert.equal(looksLikeOtelcol("anything: at: all\n", f), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("looksLikeOtelcol — rule 3: parsed structure", () => {
  it("rule 3a: matches files with service.pipelines anchor", () => {
    const text = "service:\n  pipelines:\n    traces:\n      receivers: [otlp]\n";
    assert.equal(looksLikeOtelcol(text, null), true);
  });

  it("rule 3b: matches files with ≥2 top-level otelcol keys", () => {
    const text = "receivers:\n  otlp: {}\nexporters:\n  debug: {}\n";
    assert.equal(looksLikeOtelcol(text, null), true);
  });

  it("does NOT match a file with zero otelcol keys", () => {
    assert.equal(looksLikeOtelcol("foo: 1\nbar: 2\n", null), false);
  });

  it("does NOT match a single-key fragment with no fsPath (cannot sibling-scan)", () => {
    assert.equal(looksLikeOtelcol("receivers:\n  otlp: {}\n", null), false);
  });
});

describe("looksLikeOtelcol — rule 4: sibling sidecar", () => {
  it("matches a fragment when otelcol-configset.yaml lives next to it", () => {
    const dir = scratch();
    try {
      const frag = join(dir, "exporters.yaml");
      writeFileSync(frag, "exporters:\n  debug: {}\n");
      writeFileSync(join(dir, "otelcol-configset.yaml"), "members:\n  - exporters.yaml\n");
      assert.equal(looksLikeOtelcol("exporters:\n  debug: {}\n", frag), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("looksLikeOtelcol — rule 5: sibling anchor / directive", () => {
  it("rule 5a: matches when a sibling's directive names this file", () => {
    const dir = scratch();
    try {
      const frag = join(dir, "myexporter.yaml");
      writeFileSync(frag, "exporters:\n  debug: {}\n");
      writeFileSync(
        join(dir, "pipelines.yaml"),
        "# otelcol-configset: myexporter.yaml pipelines.yaml\nfoo: bar\n",
      );
      assert.equal(looksLikeOtelcol("exporters:\n  debug: {}\n", frag), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rule 5b: matches when a sibling is itself an anchor", () => {
    const dir = scratch();
    try {
      const frag = join(dir, "myexporter.yaml");
      writeFileSync(frag, "exporters:\n  debug: {}\n");
      writeFileSync(
        join(dir, "pipelines.yaml"),
        "service:\n  pipelines:\n    traces:\n      receivers: [otlp]\n",
      );
      assert.equal(looksLikeOtelcol("exporters:\n  debug: {}\n", frag), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT match when no qualifying siblings exist", () => {
    const dir = scratch();
    try {
      const frag = join(dir, "myexporter.yaml");
      writeFileSync(frag, "exporters:\n  debug: {}\n");
      writeFileSync(join(dir, "unrelated.yaml"), "name: foo\nage: 42\n");
      assert.equal(looksLikeOtelcol("exporters:\n  debug: {}\n", frag), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("looksLikeOtelcol — example fixture", () => {
  it("recognises examples/simple/otelcol-config.yaml via rule 3a (anchor)", async () => {
    const { readFileSync } = await import("node:fs");
    const exampleDir = resolve(root, "examples", "simple");
    const exampleFile = join(exampleDir, "otelcol-config.yaml");
    const text = readFileSync(exampleFile, "utf8");
    assert.equal(
      looksLikeOtelcol(text, exampleFile),
      true,
      "the canonical simple example must be sniffed as otelcol — this is the use case driving server-side sniffing for Zed",
    );
  });
});

describe("looksLikeOtelcol — diagnostic logger", () => {
  it("invokes the optional logger with rule-naming messages on each decision point", () => {
    const lines = [];
    const log = (m) => lines.push(m);
    looksLikeOtelcol("# otelcol-configset: a.yaml\nkey: 1\n", null, log);
    assert.ok(
      lines.some((l) => l.includes("match rule 1")),
      `logger should emit a rule-1 match line; got: ${JSON.stringify(lines)}`,
    );
  });
});
