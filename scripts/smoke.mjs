#!/usr/bin/env node
// Smoke test. Two modes:
//   node scripts/smoke.mjs <config.yaml>            — single-file model
//   node scripts/smoke.mjs --set <dir>              — scan dir as a workspace,
//                                                     discover config sets, validate
//                                                     each across its members

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
process.chdir(root);

const { validatePipelines } = await import(resolve(root, "out/server/pipeline.js"));
const { loadComponents } = await import(resolve(root, "out/server/components.js"));
const { singletonSetModel, buildSetModel } = await import(resolve(root, "out/server/set-model.js"));
const { ConfigSetIndex, fsToUri } = await import(resolve(root, "out/server/configset.js"));

const idx = loadComponents(resolve(root, "out", "server"));

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error("usage: node scripts/smoke.mjs <config.yaml>\n       node scripts/smoke.mjs --set <dir>");
  process.exit(1);
}

if (argv[0] === "--set") {
  const dir = resolve(argv[1] ?? ".");
  const index = new ConfigSetIndex({ autoDiscover: true, maxFilesScanned: 2000 });
  index.setRoots([dir]);
  index.rescan();
  const sets = index.allSets();
  console.log(`discovered ${sets.length} config set(s) under ${dir}`);
  for (const set of sets) {
    console.log(`\nset anchor: ${set.anchorUri} (${set.explicit ?? "auto"})`);
    for (const m of set.members) console.log(`  member: ${m}`);
    const contents = new Map();
    for (const uri of set.members) {
      const fsPath = uri.replace(/^file:\/\//, "");
      contents.set(uri, readFileSync(fsPath, "utf8"));
    }
    const model = buildSetModel(set, contents);
    summarize(model);
    const diags = validatePipelines(model, idx);
    console.log(`diagnostics: ${diags.length}`);
    for (const d of diags) {
      const sev = ["", "error", "warning", "info", "hint"][d.diagnostic.severity];
      const short = d.sourceUri.slice(d.sourceUri.lastIndexOf("/") + 1);
      console.log(`  [${sev}] ${short} L${d.diagnostic.range.start.line + 1}: ${d.diagnostic.message}`);
    }
  }
  process.exit(0);
}

const path = argv[0];
const text = readFileSync(path, "utf8");
const uri = fsToUri(resolve(path));
const model = singletonSetModel(uri, text);
summarize(model);
const diags = [
  ...[...model.members.values()].flatMap((m) =>
    m.diagnostics.map((d) => ({ sourceUri: m.sourceUri, diagnostic: { severity: 1, message: d.message, range: d.range } })),
  ),
  ...validatePipelines(model, idx),
];
console.log(`\ndiagnostics: ${diags.length}`);
for (const d of diags) {
  const sev = typeof d.diagnostic.severity === "number" ? ["", "error", "warning", "info", "hint"][d.diagnostic.severity] : d.diagnostic.severity;
  console.log(`  [${sev}] L${d.diagnostic.range.start.line + 1}: ${d.diagnostic.message}`);
}

function summarize(model) {
  const c = model.components;
  console.log(
    `components: receivers=${c.receiver.size} processors=${c.processor.size} exporters=${c.exporter.size} connectors=${c.connector.size} extensions=${c.extension.size}`,
  );
  console.log(`pipelines: ${model.pipelines.length}`);
  for (const p of model.pipelines) {
    console.log(`  ${p.id}: receivers=[${p.receivers.map((r) => r.id).join(", ")}] processors=[${p.processors.map((r) => r.id).join(", ")}] exporters=[${p.exporters.map((r) => r.id).join(", ")}]`);
  }
  console.log(`ottl blocks: ${model.ottlBlocks.length}`);
}
