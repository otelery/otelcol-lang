// Comprehensive test suite covering config-set discovery, set-model building,
// pipeline validation, find-references, and hover "used in" across every
// fixture in test/configsets/ plus the production-shape test/complex/.
//
// Runs with Node's built-in test runner — no external deps. Invoke via:
//   make test-unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const { buildSetModel } = await import(resolve(root, "out/server/set-model.js"));
const { ConfigSetIndex, fsToUri } = await import(resolve(root, "out/server/configset.js"));
const { validatePipelines } = await import(resolve(root, "out/server/pipeline.js"));
const { loadComponents } = await import(resolve(root, "out/server/components.js"));
const { pipelineRefsTo, pipelinesUsing, pipelineIdRefsTo, pipelineIdContextsUsing } = await import(
  resolve(root, "out/server/usage.js")
);
const { looksLikeOtelcol } = await import(resolve(root, "out/extension/sniffer.js"));
const { computeSemanticTokens, encodeSemanticTokens, SEMTOK_TYPES, SEMTOK_MODIFIERS } =
  await import(resolve(root, "out/server/semantic-tokens.js"));

const idx = loadComponents(resolve(root, "out", "server"));

function discoverSets(fixtureDir) {
  const index = new ConfigSetIndex({ autoDiscover: true, maxFilesScanned: 2000 });
  index.setRoots([resolve(root, fixtureDir)]);
  index.rescan();
  return index;
}

function buildFor(set) {
  const contents = new Map();
  for (const uri of set.members) {
    const fsPath = uri.replace(/^file:\/\//, "");
    contents.set(uri, readFileSync(fsPath, "utf8"));
  }
  return buildSetModel(set, contents);
}

function memberUri(set, basename) {
  return set.members.find((u) => u.endsWith("/" + basename));
}

// ─── discovery ────────────────────────────────────────────────────────────

describe("ConfigSetIndex discovery", () => {
  it("test/complex: one set, four members, anchor last", () => {
    const sets = discoverSets("test/complex").allSets();
    assert.equal(sets.length, 1);
    const [s] = sets;
    assert.equal(s.explicit, null);
    assert.equal(s.members.length, 4);
    assert.ok(s.members[s.members.length - 1].endsWith("/pipelines.yaml"));
  });

  it("staging-prod: two independent anchors, no cross-contamination", () => {
    const sets = discoverSets("test/configsets/staging-prod").allSets();
    assert.equal(sets.length, 2);
    for (const s of sets) {
      // Each set's members are all under its anchor's directory.
      const anchorDir = dirname(s.anchorUri);
      for (const m of s.members)
        assert.ok(m.startsWith(anchorDir + "/"), `${m} not under ${anchorDir}`);
      assert.equal(s.members.length, 2);
    }
  });

  it("sidecar: explicit:'sidecar', order from members list", () => {
    const sets = discoverSets("test/configsets/sidecar").allSets();
    assert.equal(sets.length, 1);
    const [s] = sets;
    assert.equal(s.explicit, "sidecar");
    assert.ok(s.members[0].endsWith("/base.yaml"));
    assert.ok(s.members[1].endsWith("/exporters.yaml"));
    assert.ok(s.members[2].endsWith("/pipelines.yaml"));
  });

  it("directive: explicit:'directive' on first-line marker", () => {
    const sets = discoverSets("test/configsets/directive").allSets();
    assert.equal(sets.length, 1);
    const [s] = sets;
    assert.equal(s.explicit, "directive");
    assert.equal(s.members.length, 3);
  });

  it("directive: every member (incl. base.yaml) maps back to the set via getSetForUri", () => {
    const index = discoverSets("test/configsets/directive");
    const [s] = index.allSets();
    for (const m of s.members) {
      const found = index.getSetForUri(m);
      assert.ok(found, `getSetForUri(${m}) returned null — file is not associated with its set`);
      assert.equal(found.anchorUri, s.anchorUri);
    }
  });

  it("directive: looksLikeOtelcol recognises base.yaml (single-section fragment listed by a sibling directive)", () => {
    const baseFs = resolve(root, "test/configsets/directive/base.yaml");
    const text = readFileSync(baseFs, "utf8");
    assert.equal(
      looksLikeOtelcol(text, baseFs),
      true,
      "base.yaml has only `receivers:` but a sibling pipelines.yaml has `# otelcol-configset: base.yaml exporters.yaml pipelines.yaml` — it should retag to otelcol",
    );
  });

  it("directive: pipelineRefsTo on `otlp` (defined in base.yaml) finds the ref in pipelines.yaml", () => {
    const set = discoverSets("test/configsets/directive").allSets()[0];
    const model = buildFor(set);
    const refs = pipelineRefsTo(model, "receiver", "otlp");
    assert.equal(
      refs.length,
      1,
      `expected 1 ref to otlp, got ${refs.length}: ${JSON.stringify(refs)}`,
    );
    assert.ok(refs[0].uri.endsWith("/pipelines.yaml"));
  });

  it("duplicates: one set with three members", () => {
    const sets = discoverSets("test/configsets/duplicates").allSets();
    assert.equal(sets.length, 1);
    assert.equal(sets[0].members.length, 3);
  });

  it("unused: anchor + one fragment", () => {
    const sets = discoverSets("test/configsets/unused").allSets();
    assert.equal(sets.length, 1);
    assert.equal(sets[0].members.length, 2);
  });

  it("missing-ref: anchor + one fragment", () => {
    const sets = discoverSets("test/configsets/missing-ref").allSets();
    assert.equal(sets.length, 1);
    assert.equal(sets[0].members.length, 2);
  });

  it("getSetForUri returns set for every member", () => {
    const index = discoverSets("test/complex");
    const set = index.allSets()[0];
    for (const m of set.members) {
      const found = index.getSetForUri(m);
      assert.equal(found?.anchorUri, set.anchorUri);
    }
  });

  it("getSetForUri returns null for a yaml file outside any anchor's subtree", () => {
    const index = discoverSets("test/configsets/staging-prod");
    // A bogus URI in the parent dir, not under any anchor.
    const bogus = fsToUri(resolve(root, "test/configsets/staging-prod/nonexistent.yaml"));
    assert.equal(index.getSetForUri(bogus), null);
  });
});

// ─── set-model + validation ───────────────────────────────────────────────

describe("SetModel build + validatePipelines", () => {
  it("test/complex: zero diagnostics", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    const diags = validatePipelines(model, idx);
    assert.equal(diags.length, 0, `expected zero diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("staging-prod: zero diagnostics per set", () => {
    const sets = discoverSets("test/configsets/staging-prod").allSets();
    for (const s of sets) {
      assert.equal(validatePipelines(buildFor(s), idx).length, 0);
    }
  });

  it("sidecar: zero diagnostics", () => {
    const set = discoverSets("test/configsets/sidecar").allSets()[0];
    assert.equal(validatePipelines(buildFor(set), idx).length, 0);
  });

  it("directive: zero diagnostics", () => {
    const set = discoverSets("test/configsets/directive").allSets()[0];
    assert.equal(validatePipelines(buildFor(set), idx).length, 0);
  });

  it("duplicates: ambiguous-ref + 2x duplicate-id, all errors", () => {
    const set = discoverSets("test/configsets/duplicates").allSets()[0];
    const model = buildFor(set);
    const diags = validatePipelines(model, idx);
    const errs = diags.filter((d) => d.diagnostic.severity === 1);
    assert.equal(errs.length, 3);
    assert.equal(diags.filter((d) => /ambiguous reference/.test(d.diagnostic.message)).length, 1);
    assert.equal(diags.filter((d) => /duplicate receiver id/.test(d.diagnostic.message)).length, 2);
    // Ambiguous ref attributed to pipelines.yaml; duplicates to the defining files.
    const ambig = diags.find((d) => /ambiguous/.test(d.diagnostic.message));
    assert.ok(ambig.sourceUri.endsWith("/pipelines.yaml"));
    const dupSources = diags
      .filter((d) => /duplicate/.test(d.diagnostic.message))
      .map((d) => d.sourceUri);
    assert.ok(dupSources.some((u) => u.endsWith("/base.yaml")));
    assert.ok(dupSources.some((u) => u.endsWith("/extras.yaml")));
  });

  it("duplicates: diagnostic ranges land on the offending token", () => {
    const set = discoverSets("test/configsets/duplicates").allSets()[0];
    const diags = validatePipelines(buildFor(set), idx);
    for (const d of diags) {
      const r = d.diagnostic.range;
      assert.ok(r, "every diagnostic must carry a range");
      assert.ok(
        Number.isInteger(r.start.line) && r.start.line >= 0,
        `bad start.line: ${r.start.line}`,
      );
      assert.ok(Number.isInteger(r.start.character) && r.start.character >= 0);
      assert.ok(
        r.end.line > r.start.line ||
          (r.end.line === r.start.line && r.end.character > r.start.character),
        `end must be after start, got ${JSON.stringify(r)}`,
      );
    }
    // Duplicate "otlp" definition in extras.yaml is on line 1 (`  otlp:` at line index 1).
    const extrasUri = memberUri(set, "extras.yaml");
    const extrasText = readFileSync(extrasUri.replace(/^file:\/\//, ""), "utf8");
    const dupInExtras = diags.find(
      (d) => /duplicate receiver id/.test(d.diagnostic.message) && d.sourceUri === extrasUri,
    );
    assert.ok(dupInExtras, "expected the duplicate diag attributed to extras.yaml");
    const lineText = extrasText.split("\n")[dupInExtras.diagnostic.range.start.line];
    assert.match(
      lineText,
      /\botlp\b/,
      `range points at line ${dupInExtras.diagnostic.range.start.line} = ${JSON.stringify(lineText)}; expected the line containing 'otlp'`,
    );
  });

  it("unused: one Information diagnostic with DiagnosticTag.Unnecessary", () => {
    const set = discoverSets("test/configsets/unused").allSets()[0];
    const diags = validatePipelines(buildFor(set), idx);
    assert.equal(diags.length, 1);
    const [d] = diags;
    assert.equal(d.diagnostic.severity, 3, "Information");
    assert.deepEqual(d.diagnostic.tags, [1] /* DiagnosticTag.Unnecessary */);
    assert.match(d.diagnostic.message, /otlp\/unused/);
    assert.ok(d.sourceUri.endsWith("/base.yaml"));
  });

  it("unused: diagnostic range covers the otlp/unused identifier on its declaration line", () => {
    const set = discoverSets("test/configsets/unused").allSets()[0];
    const diags = validatePipelines(buildFor(set), idx);
    const [d] = diags;
    const baseText = readFileSync(memberUri(set, "base.yaml").replace(/^file:\/\//, ""), "utf8");
    const lineText = baseText.split("\n")[d.diagnostic.range.start.line];
    assert.match(
      lineText,
      /otlp\/unused/,
      `unused diag range points at line ${d.diagnostic.range.start.line} = ${JSON.stringify(lineText)}; expected the line containing 'otlp/unused'`,
    );
  });

  it("missing-ref: one undefined-receiver error attributed to pipelines.yaml", () => {
    const set = discoverSets("test/configsets/missing-ref").allSets()[0];
    const diags = validatePipelines(buildFor(set), idx);
    const err = diags.find((d) => /receiver "ghost" is not defined/.test(d.diagnostic.message));
    assert.ok(err, "expected an undefined-receiver error");
    assert.ok(err.sourceUri.endsWith("/pipelines.yaml"));
  });

  it("missing-ref: range points at the 'ghost' token in the receivers list", () => {
    const set = discoverSets("test/configsets/missing-ref").allSets()[0];
    const diags = validatePipelines(buildFor(set), idx);
    const err = diags.find((d) => /receiver "ghost"/.test(d.diagnostic.message));
    const text = readFileSync(memberUri(set, "pipelines.yaml").replace(/^file:\/\//, ""), "utf8");
    const lineText = text.split("\n")[err.diagnostic.range.start.line];
    assert.match(
      lineText,
      /ghost/,
      `range line = ${JSON.stringify(lineText)}; expected the line containing 'ghost'`,
    );
    // Range should cover the word 'ghost', not the whole sequence.
    const span = lineText.substring(
      err.diagnostic.range.start.character,
      err.diagnostic.range.end.character,
    );
    assert.equal(span, "ghost", `range span = ${JSON.stringify(span)}; expected exactly 'ghost'`);
  });
});

// ─── usage helpers (powers references + codelens + hover used-in) ────────

describe("usage helpers", () => {
  it("test/complex: pipelineRefsTo on otlp/primary returns 5 refs", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    const refs = pipelineRefsTo(model, "exporter", "otlp/primary");
    assert.equal(refs.length, 5);
    for (const r of refs) assert.ok(r.uri.endsWith("/pipelines.yaml"));
  });

  it("test/complex: pipelinesUsing on otlp/primary lists 5 unique pipelines", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    const pipes = pipelinesUsing(model, "exporter", "otlp/primary");
    assert.deepEqual(
      new Set(pipes),
      new Set(["traces/acme", "traces/canary", "traces/general", "metrics", "logs/sink"]),
    );
  });

  it("test/complex: connector routing/by-tenant used as exporter AND receiver", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    const refs = pipelineRefsTo(model, "connector", "routing/by-tenant");
    // routing/by-tenant: exported by `traces` (1) and received by acme/globex/canary/general (4) → 5 total.
    assert.equal(refs.length, 5);
  });

  it("unused: pipelineRefsTo on otlp/unused returns empty list", () => {
    const set = discoverSets("test/configsets/unused").allSets()[0];
    const model = buildFor(set);
    assert.equal(pipelineRefsTo(model, "exporter", "otlp/unused").length, 0);
    assert.equal(pipelinesUsing(model, "exporter", "otlp/unused").length, 0);
  });

  it("references span source URIs of the original files", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    const refs = pipelineRefsTo(model, "receiver", "otlp");
    // `otlp` is used in traces, metrics, logs — all in pipelines.yaml.
    assert.ok(refs.length >= 3);
    for (const r of refs) assert.ok(r.uri.endsWith("/pipelines.yaml"));
  });
});

// ─── sourceUri provenance ─────────────────────────────────────────────────

describe("sourceUri provenance", () => {
  it("test/complex: receivers defined in base.yaml carry that uri", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    const otlp = model.components.receiver.get("otlp");
    assert.ok(otlp);
    assert.ok(otlp.sourceUri.endsWith("/base.yaml"), `expected base.yaml, got ${otlp.sourceUri}`);
  });

  it("test/complex: exporters defined in exporters.yaml carry that uri", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    const exp = model.components.exporter.get("otlp/primary");
    assert.ok(exp);
    assert.ok(exp.sourceUri.endsWith("/exporters.yaml"));
  });

  it("test/complex: connectors defined in pipelines.yaml carry that uri", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    const conn = model.components.connector.get("routing/by-tenant");
    assert.ok(conn);
    assert.ok(conn.sourceUri.endsWith("/pipelines.yaml"));
  });

  it("staging and prod sets keep separate provenance", () => {
    const sets = discoverSets("test/configsets/staging-prod").allSets();
    for (const s of sets) {
      const model = buildFor(s);
      const otlp = model.components.receiver.get("otlp");
      const dir = dirname(s.anchorUri);
      assert.ok(otlp.sourceUri.startsWith(dir + "/"), `${otlp.sourceUri} not under ${dir}`);
    }
  });
});

// ─── extensions (service.extensions) ─────────────────────────────────────

describe("extensions: service.extensions references", () => {
  it("test/complex: each declared extension is referenced exactly once", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    for (const id of ["health_check", "pprof", "zpages"]) {
      const refs = pipelineRefsTo(model, "extension", id);
      assert.equal(refs.length, 1, `${id}: expected 1 ref, got ${refs.length}`);
      assert.ok(refs[0].uri.endsWith("/base.yaml"));
    }
  });

  it("test/complex: pipelinesUsing for an extension returns ['service.extensions']", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    assert.deepEqual(pipelinesUsing(model, "extension", "health_check"), ["service.extensions"]);
  });

  it("test/complex: clean run, zero diagnostics including extensions", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const diags = validatePipelines(buildFor(set), idx);
    assert.equal(diags.length, 0);
  });

  it("ext-unused: pprof is flagged as defined-but-unused", () => {
    const set = discoverSets("test/configsets/ext-unused").allSets()[0];
    const diags = validatePipelines(buildFor(set), idx);
    const unused = diags.find((d) => /extension "pprof"/.test(d.diagnostic.message));
    assert.ok(
      unused,
      `expected unused-extension diag; got ${JSON.stringify(diags.map((d) => d.diagnostic.message))}`,
    );
    assert.equal(unused.diagnostic.severity, 3 /* Information */);
    assert.deepEqual(unused.diagnostic.tags, [1] /* DiagnosticTag.Unnecessary */);
    assert.match(unused.diagnostic.message, /service\.extensions/);
  });

  it("ext-unused: health_check IS referenced (not flagged)", () => {
    const set = discoverSets("test/configsets/ext-unused").allSets()[0];
    const diags = validatePipelines(buildFor(set), idx);
    const refs = pipelineRefsTo(model_for(set), "extension", "health_check");
    assert.equal(refs.length, 1);
    const unused = diags.find((d) => /extension "health_check"/.test(d.diagnostic.message));
    assert.equal(unused, undefined);
  });

  it("ext-missing: unknown extension `ghost` produces an error attributed to pipelines.yaml", () => {
    const set = discoverSets("test/configsets/ext-missing").allSets()[0];
    const diags = validatePipelines(buildFor(set), idx);
    const err = diags.find((d) => /extension "ghost" is not defined/.test(d.diagnostic.message));
    assert.ok(err, "expected an undefined-extension error");
    assert.equal(err.diagnostic.severity, 1 /* Error */);
    assert.ok(err.sourceUri.endsWith("/pipelines.yaml"));
  });

  it("serviceExtensions array carries the defining file's URI", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    assert.ok(model.serviceExtensions.length >= 3);
    for (const ref of model.serviceExtensions) {
      assert.ok(ref.sourceUri.endsWith("/base.yaml"));
    }
  });
});

function model_for(set) {
  return buildFor(set);
}

// ─── cross-config extension refs (auth/storage/encoding/observers/chaining) ─

describe("cross-config extension refs", () => {
  it("ref-auth: oauth2client/primary referenced via auth.authenticator", () => {
    const set = discoverSets("test/configsets/ref-auth").allSets()[0];
    const model = buildFor(set);
    // service.extensions + auth.authenticator → 2 refs total.
    const refs = pipelineRefsTo(model, "extension", "oauth2client/primary");
    assert.equal(refs.length, 2);
    const contexts = pipelinesUsing(model, "extension", "oauth2client/primary");
    assert.ok(contexts.includes("service.extensions"));
    assert.ok(contexts.some((c) => c.endsWith(".auth.authenticator")));
    assert.equal(validatePipelines(model, idx).length, 0);
  });

  it("ref-auth: removing the extension makes auth.authenticator error", () => {
    // Simulate by parsing only an exporter+pipelines config with no matching extension.
    const set = discoverSets("test/configsets/ref-auth").allSets()[0];
    const contents = new Map();
    for (const uri of set.members) {
      const text = readFileSync(uri.replace(/^file:\/\//, ""), "utf8");
      // Strip the extensions: block so the ref dangles.
      contents.set(
        uri,
        text.replace(/^extensions:[\s\S]*?(?=\n(?:receivers|exporters|service|connectors):)/m, ""),
      );
    }
    const model = buildSetModel(set, contents);
    const diags = validatePipelines(model, idx);
    const err = diags.find((d) =>
      /extension "oauth2client\/primary" is not defined/.test(d.diagnostic.message),
    );
    assert.ok(
      err,
      `expected undefined-extension diag from auth.authenticator; got ${JSON.stringify(diags.map((d) => d.diagnostic.message))}`,
    );
    assert.match(err.diagnostic.message, /auth\.authenticator/);
  });

  it("ref-storage: file_storage/queue referenced via .storage", () => {
    const set = discoverSets("test/configsets/ref-storage").allSets()[0];
    const model = buildFor(set);
    const refs = pipelineRefsTo(model, "extension", "file_storage/queue");
    assert.equal(refs.length, 2); // service.extensions + sending_queue.storage
    const contexts = pipelinesUsing(model, "extension", "file_storage/queue");
    assert.ok(contexts.some((c) => c.endsWith(".storage")));
    assert.equal(validatePipelines(model, idx).length, 0);
  });

  it("ref-encoding: resolves to extension when name matches; built-in name has no diag", () => {
    const set = discoverSets("test/configsets/ref-encoding").allSets()[0];
    const model = buildFor(set);
    // jaeger_encoding/v1 resolves (2 refs: service.extensions + file/sink.encoding).
    assert.equal(pipelineRefsTo(model, "extension", "jaeger_encoding/v1").length, 2);
    // 'json' is a built-in format → no extension lookup, no diag.
    const diags = validatePipelines(model, idx);
    assert.equal(diags.filter((d) => /"json"/.test(d.diagnostic.message)).length, 0);
    assert.equal(diags.length, 0);
  });

  it("ref-watch-observers: each observer listed counts as a ref", () => {
    const set = discoverSets("test/configsets/ref-watch-observers").allSets()[0];
    const model = buildFor(set);
    // service.extensions + watch_observers[] → 2 refs per observer.
    assert.equal(pipelineRefsTo(model, "extension", "k8s_observer").length, 2);
    assert.equal(pipelineRefsTo(model, "extension", "docker_observer").length, 2);
    const contexts = pipelinesUsing(model, "extension", "k8s_observer");
    assert.ok(contexts.some((c) => c.endsWith(".watch_observers[]")));
    assert.equal(validatePipelines(model, idx).length, 0);
  });

  it("ref-additional-auth: extension chaining via additional_auth", () => {
    const set = discoverSets("test/configsets/ref-additional-auth").allSets()[0];
    const model = buildFor(set);
    // bearertokenauth/primary referenced from headers_setter/inject.additional_auth + service.extensions.
    const refs = pipelineRefsTo(model, "extension", "bearertokenauth/primary");
    assert.equal(refs.length, 2);
    const contexts = pipelinesUsing(model, "extension", "bearertokenauth/primary");
    assert.ok(contexts.some((c) => c.endsWith(".additional_auth")));
    assert.equal(validatePipelines(model, idx).length, 0);
  });
});

// ─── connector pipeline-id refs (routing, failover) ──────────────────────

describe("connector pipeline-id refs", () => {
  it("ref-routing: default_pipelines + table.pipelines all resolve", () => {
    const set = discoverSets("test/configsets/ref-routing").allSets()[0];
    const model = buildFor(set);
    assert.equal(pipelineIdRefsTo(model, "traces/general").length, 1);
    assert.equal(pipelineIdRefsTo(model, "traces/acme").length, 1);
    assert.equal(pipelineIdRefsTo(model, "traces/globex").length, 1);
    const ctx = pipelineIdContextsUsing(model, "traces/acme");
    assert.ok(ctx[0].includes("table[0].pipelines"), `expected table[0].pipelines, got ${ctx[0]}`);
    assert.equal(validatePipelines(model, idx).length, 0);
  });

  it("ref-failover: priority_levels resolves at every nesting depth", () => {
    const set = discoverSets("test/configsets/ref-failover").allSets()[0];
    const model = buildFor(set);
    assert.equal(pipelineIdRefsTo(model, "traces/primary").length, 1);
    assert.equal(pipelineIdRefsTo(model, "traces/secondary").length, 1);
    assert.equal(pipelineIdRefsTo(model, "traces/tertiary").length, 1);
    const ctx = pipelineIdContextsUsing(model, "traces/primary");
    assert.ok(ctx[0].includes("priority_levels[0]"));
    const ctx2 = pipelineIdContextsUsing(model, "traces/tertiary");
    assert.ok(ctx2[0].includes("priority_levels[1]"));
    assert.equal(validatePipelines(model, idx).length, 0);
  });

  it("ref-missing-pipeline: undefined pipeline produces an error with fieldPath", () => {
    const set = discoverSets("test/configsets/ref-missing-pipeline").allSets()[0];
    const model = buildFor(set);
    const diags = validatePipelines(model, idx);
    const err = diags.find((d) =>
      /pipeline "traces\/ghost" is not defined/.test(d.diagnostic.message),
    );
    assert.ok(err);
    assert.match(err.diagnostic.message, /default_pipelines/);
  });

  it("test/complex routing connector: all 4 pipeline refs resolve", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    for (const id of ["traces/acme", "traces/globex", "traces/canary", "traces/general"]) {
      assert.equal(pipelineIdRefsTo(model, id).length, 1, `${id} expected 1 routing ref`);
    }
  });
});

// ─── parse-error attribution ──────────────────────────────────────────────

describe("parse diagnostics attribute to the defining file", () => {
  it("each DocModel carries its own sourceUri", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    for (const [uri, dm] of model.members) {
      assert.equal(dm.sourceUri, uri);
      for (const d of dm.diagnostics) assert.equal(d.sourceUri, uri);
    }
  });
});

// ─── looksLikeOtelcol sniffer (extension-side language retag) ────────────
//
// Each test isolates ONE rule by building a minimal fixture in a tmp dir,
// then exercises positive and negative paths. Rules from src/extension/sniffer.ts:
//   (a) anchor — `service:` + indented `pipelines:` child
//   (b) two or more top-level otelcol keys
//   (c) `# otelcol-configset:` directive in the file itself
//   (d) sibling `otelcol-configset.yaml` sidecar in same dir
//   (e) sibling YAML carries an `# otelcol-configset:` directive that names this file

describe("looksLikeOtelcol sniffer", () => {
  let tmp;
  function mk(name, content) {
    const p = join(tmp, name);
    writeFileSync(p, content);
    return p;
  }
  function fresh() {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = mkdtempSync(join(tmpdir(), "otelcol-sniff-"));
  }

  // (a) anchor
  it("(a) anchor: service.pipelines triggers true", () => {
    fresh();
    const f = mk("x.yaml", "service:\n  pipelines:\n    traces:\n      receivers: [otlp]\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });
  it("(a) anchor: bare `service:` with no `pipelines:` child does NOT match alone", () => {
    fresh();
    const f = mk("x.yaml", "service:\n  telemetry:\n    logs:\n      level: info\n");
    // Only one top-level otelcol key (`service`), no anchor, no directive, no siblings.
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), false);
  });

  // (b) ≥2 top-level otelcol keys
  it("(b) two keys: receivers + exporters triggers true", () => {
    fresh();
    const f = mk("x.yaml", "receivers:\n  otlp:\nexporters:\n  debug:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });
  it("(b) one key alone (receivers only) does NOT match", () => {
    fresh();
    const f = mk("x.yaml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), false);
  });

  // (c) self-directive
  it("(c) `# otelcol-configset:` directive in the file triggers true", () => {
    fresh();
    const f = mk("x.yaml", "# otelcol-configset: a.yaml b.yaml\nreceivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });
  it("(c) similarly-named comment (`# otelcol-foo:`) does NOT trigger the directive rule", () => {
    fresh();
    const f = mk("x.yaml", "# otelcol-foo: bar\nreceivers:\n  otlp:\n");
    // Single key + no real directive → false.
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), false);
  });

  // (d) sidecar
  it("(d) sibling `otelcol-configset.yaml` sidecar triggers true even with one key", () => {
    fresh();
    mk("otelcol-configset.yaml", "members:\n  - x.yaml\n");
    const f = mk("x.yaml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });

  // (e) sibling directive names this file
  it("(e) sibling YAML names this file in its directive triggers true", () => {
    fresh();
    mk(
      "pipelines.yaml",
      "# otelcol-configset: base.yaml pipelines.yaml\nservice:\n  pipelines:\n    traces: { receivers: [otlp], exporters: [debug] }\n",
    );
    const f = mk("base.yaml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });
  it("(e) sibling directive that does NOT list this file → false", () => {
    fresh();
    // Sibling has a directive listing other files, but is NOT itself an anchor
    // (no `service: + pipelines:`), so rule (f) can't accidentally rescue this.
    mk("notes.yaml", "# otelcol-configset: a.yaml notes.yaml\nfoo: 1\n");
    const f = mk("base.yaml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), false);
  });
  it("(e) works for .yml extension as well as .yaml", () => {
    fresh();
    mk(
      "pipelines.yaml",
      "# otelcol-configset: base.yml pipelines.yaml\nservice:\n  pipelines: {}\n",
    );
    const f = mk("base.yml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });
  it("(e) the sibling scan ignores the file itself (no false positive from self-match in a dir of one)", () => {
    fresh();
    // Only file in the dir; no directive in it. Must return false even though
    // basename-matching would trivially succeed if self were considered.
    const f = mk("base.yaml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), false);
  });

  // (f) sibling anchor (any pipelines-bearing file in the same dir)
  it("(f) single-key fragment next to a sibling pipelines file → true", () => {
    fresh();
    mk(
      "pipelines.yaml",
      "service:\n  pipelines:\n    traces: { receivers: [otlp], exporters: [debug] }\n",
    );
    const f = mk("base.yaml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });
  it("(f) works for a one-key exporters fragment too (matches `directive/exporters.yaml`)", () => {
    fresh();
    mk(
      "pipelines.yaml",
      "service:\n  pipelines:\n    traces: { receivers: [otlp], exporters: [debug] }\n",
    );
    const f = mk("exporters.yaml", "exporters:\n  debug:\n    verbosity: detailed\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });
  it("(f) sibling anchor can be in a .yml file", () => {
    fresh();
    mk("pipelines.yml", "service:\n  pipelines:\n    traces: { receivers: [otlp] }\n");
    const f = mk("base.yaml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });
  it("(f) negative: single-key fragment with no anchor sibling → false", () => {
    fresh();
    mk("other.yaml", "key: value\n"); // not an anchor, not a directive, doesn't list base.yaml
    const f = mk("base.yaml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), false);
  });
  it("(f) negative: sibling has `service:` but no `pipelines:` child → false", () => {
    fresh();
    mk("other.yaml", "service:\n  telemetry:\n    logs:\n      level: info\n");
    const f = mk("base.yaml", "receivers:\n  otlp:\n");
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), false);
  });

  // Fixture spot-checks for the new rule.
  it("fixture: test/configsets/directive/exporters.yaml → true via (e) or (f)", () => {
    const p = resolve(root, "test/configsets/directive/exporters.yaml");
    assert.equal(looksLikeOtelcol(readFileSync(p, "utf8"), p), true);
  });
  it("fixture: test/configsets/staging-prod/staging/base.yaml → true via (f)", () => {
    const p = resolve(root, "test/configsets/staging-prod/staging/base.yaml");
    assert.equal(looksLikeOtelcol(readFileSync(p, "utf8"), p), true);
  });

  // fsPath plumbing
  it("fsPath=null: content-only rules still work (anchor)", () => {
    assert.equal(
      looksLikeOtelcol("service:\n  pipelines:\n    traces: { receivers: [otlp] }\n", null),
      true,
    );
  });
  it("fsPath=null: directory-based rules (d/e) are skipped (single-key fragment → false)", () => {
    assert.equal(looksLikeOtelcol("receivers:\n  otlp:\n", null), false);
  });

  // Combination coverage: multiple rules simultaneously → still true
  it("combo: anchor + sidecar + directive → true (independent rules don't interfere)", () => {
    fresh();
    mk("otelcol-configset.yaml", "members: [x.yaml]\n");
    const f = mk(
      "x.yaml",
      "# otelcol-configset: x.yaml\nservice:\n  pipelines:\n    traces: { receivers: [otlp] }\n",
    );
    assert.equal(looksLikeOtelcol(readFileSync(f, "utf8"), f), true);
  });

  // Real fixtures — exercise the rules end-to-end against checked-in files.
  it("fixture: test/configsets/directive/base.yaml → true via (e)", () => {
    const p = resolve(root, "test/configsets/directive/base.yaml");
    assert.equal(looksLikeOtelcol(readFileSync(p, "utf8"), p), true);
  });
  it("fixture: test/configsets/directive/pipelines.yaml → true via (a)+(c)", () => {
    const p = resolve(root, "test/configsets/directive/pipelines.yaml");
    assert.equal(looksLikeOtelcol(readFileSync(p, "utf8"), p), true);
  });
  it("fixture: test/configsets/sidecar/base.yaml → true via (d)", () => {
    const p = resolve(root, "test/configsets/sidecar/base.yaml");
    assert.equal(looksLikeOtelcol(readFileSync(p, "utf8"), p), true);
  });
  it("fixture: test/complex/pipelines.yaml → true via (a)", () => {
    const p = resolve(root, "test/complex/pipelines.yaml");
    assert.equal(looksLikeOtelcol(readFileSync(p, "utf8"), p), true);
  });
  it("fixture: test/complex/base.yaml → true via (b)", () => {
    const p = resolve(root, "test/complex/base.yaml");
    assert.equal(looksLikeOtelcol(readFileSync(p, "utf8"), p), true);
  });

  // Cleanup the last tmp dir.
  it("cleanup tmp dir", () => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });
});

// ─── semantic tokens (component IDs + pipeline IDs) ──────────────────────
//
// Token mapping (per recommendation in design discussion):
//   - class                              → pipeline-ref to a component / extension ref
//   - class | declaration                → component definition (receivers/processors/exporters/connectors/extensions entry)
//   - class | declaration | deprecated   → component defined but never referenced (matches the "unused" diagnostic)
//   - namespace                          → pipeline-id ref (routing/failover)
//   - namespace | declaration            → pipeline definition (`service.pipelines.<id>:`)

describe("semantic tokens", () => {
  // Legend must be stable — VS Code remembers the position of each name across edits.
  it("legend exposes the standard LSP types and modifiers we rely on", () => {
    assert.deepEqual([...SEMTOK_TYPES], ["class", "namespace"]);
    assert.deepEqual([...SEMTOK_MODIFIERS], ["declaration", "deprecated"]);
  });

  // Helpers for these tests.
  const T_CLASS = 0;
  const T_NAMESPACE = 1;
  const M_DECLARATION = 1 << 0;
  const M_DEPRECATED = 1 << 1;
  function tokensFor(set, basename) {
    const model = buildFor(set);
    const uri = memberUri(set, basename);
    return computeSemanticTokens(model, uri);
  }
  function wordAt(text, line, char, len) {
    return text.split("\n")[line].substring(char, char + len);
  }
  function textOf(set, basename) {
    return readFileSync(memberUri(set, basename).replace(/^file:\/\//, ""), "utf8");
  }

  it("directive/base.yaml: single class+declaration token covering `otlp`", () => {
    const set = discoverSets("test/configsets/directive").allSets()[0];
    const toks = tokensFor(set, "base.yaml");
    assert.equal(toks.length, 1, `expected 1 token, got ${JSON.stringify(toks)}`);
    const [t] = toks;
    assert.equal(t.type, T_CLASS);
    assert.equal(
      t.mods,
      M_DECLARATION,
      "referenced component should NOT carry the deprecated modifier",
    );
    assert.equal(wordAt(textOf(set, "base.yaml"), t.line, t.char, t.len), "otlp");
  });

  it("directive/exporters.yaml: single class+declaration token covering `debug`", () => {
    const set = discoverSets("test/configsets/directive").allSets()[0];
    const toks = tokensFor(set, "exporters.yaml");
    assert.equal(toks.length, 1);
    assert.equal(
      wordAt(textOf(set, "exporters.yaml"), toks[0].line, toks[0].char, toks[0].len),
      "debug",
    );
    assert.equal(toks[0].type, T_CLASS);
    assert.equal(toks[0].mods, M_DECLARATION);
  });

  it("directive/pipelines.yaml: tokens for the pipeline def AND its receiver/exporter refs", () => {
    const set = discoverSets("test/configsets/directive").allSets()[0];
    const text = textOf(set, "pipelines.yaml");
    const toks = tokensFor(set, "pipelines.yaml");
    const words = toks.map((t) => ({
      word: wordAt(text, t.line, t.char, t.len),
      type: t.type,
      mods: t.mods,
    }));
    // Pipeline declaration `traces` → namespace|declaration
    assert.ok(
      words.some((w) => w.word === "traces" && w.type === T_NAMESPACE && w.mods === M_DECLARATION),
      `expected namespace|declaration for "traces", got ${JSON.stringify(words)}`,
    );
    // Component refs `otlp`, `debug` → class, no modifiers
    assert.ok(words.some((w) => w.word === "otlp" && w.type === T_CLASS && w.mods === 0));
    assert.ok(words.some((w) => w.word === "debug" && w.type === T_CLASS && w.mods === 0));
  });

  it("unused fixture: defined-but-unreferenced component gets the deprecated modifier", () => {
    const set = discoverSets("test/configsets/unused").allSets()[0];
    const text = textOf(set, "base.yaml");
    const toks = tokensFor(set, "base.yaml");
    const unused = toks.find((t) => wordAt(text, t.line, t.char, t.len).startsWith("otlp/unused"));
    assert.ok(unused, "expected a token for otlp/unused");
    assert.equal(unused.type, T_CLASS);
    assert.equal(
      unused.mods & M_DEPRECATED,
      M_DEPRECATED,
      "unreferenced component must carry the deprecated modifier",
    );
    assert.equal(unused.mods & M_DECLARATION, M_DECLARATION);
  });

  it("tokens are sorted by (line, char)", () => {
    const set = discoverSets("test/complex").allSets()[0];
    for (const uri of set.members) {
      const toks = computeSemanticTokens(buildFor(set), uri);
      for (let i = 1; i < toks.length; i++) {
        const a = toks[i - 1],
          b = toks[i];
        assert.ok(
          a.line < b.line || (a.line === b.line && a.char < b.char),
          `tokens not sorted at ${i}: ${JSON.stringify({ a, b })}`,
        );
      }
    }
  });

  it("encodeSemanticTokens produces 5N integers with delta-encoded positions", () => {
    const set = discoverSets("test/configsets/directive").allSets()[0];
    const model = buildFor(set);
    const toks = computeSemanticTokens(model, memberUri(set, "pipelines.yaml"));
    const wire = encodeSemanticTokens(toks);
    assert.equal(wire.length, toks.length * 5);
    // First token's deltaLine/deltaChar are absolute.
    assert.equal(wire[0], toks[0].line);
    assert.equal(wire[1], toks[0].char);
    assert.equal(wire[2], toks[0].len);
    assert.equal(wire[3], toks[0].type);
    assert.equal(wire[4], toks[0].mods);
    // Subsequent tokens use deltas; reconstruct and verify against raw.
    let line = toks[0].line;
    let char = toks[0].char;
    for (let i = 1; i < toks.length; i++) {
      const dLine = wire[i * 5];
      const dChar = wire[i * 5 + 1];
      line += dLine;
      if (dLine === 0) char += dChar;
      else char = dChar;
      assert.equal(line, toks[i].line);
      assert.equal(char, toks[i].char);
      assert.equal(wire[i * 5 + 2], toks[i].len);
    }
  });

  it("complex fixture: tokens cover every component definition", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    // Count defs across the set.
    let defCount = 0;
    for (const cls of ["receiver", "processor", "exporter", "connector", "extension"]) {
      defCount += model.components[cls].size;
    }
    let declTokens = 0;
    for (const uri of set.members) {
      for (const t of computeSemanticTokens(model, uri)) {
        if (t.type === T_CLASS && t.mods & M_DECLARATION) declTokens++;
      }
    }
    assert.equal(
      declTokens,
      defCount,
      `expected ${defCount} class|declaration tokens across the set, got ${declTokens}`,
    );
  });

  it("connector counts as referenced when used as exporter OR receiver", () => {
    const set = discoverSets("test/complex").allSets()[0];
    const model = buildFor(set);
    // routing/by-tenant is a connector and IS referenced; must NOT be deprecated.
    let conn = null;
    for (const uri of set.members) {
      const text = readFileSync(uri.replace(/^file:\/\//, ""), "utf8");
      for (const t of computeSemanticTokens(model, uri)) {
        if (wordAt(text, t.line, t.char, t.len) === "routing/by-tenant" && t.mods & M_DECLARATION) {
          conn = t;
          break;
        }
      }
      if (conn) break;
    }
    assert.ok(conn, "expected a declaration token for routing/by-tenant");
    assert.equal(conn.mods & M_DEPRECATED, 0, "referenced connector should not be deprecated");
  });
});
