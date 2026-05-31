#!/usr/bin/env node
// Copy build-time schema artefacts next to the compiled server so the LSP
// resolves them at runtime without walking back to the repo root.
//
// Two trees are needed:
//   schemas/distributions/   — per-distribution component metadata index
//   schemas/json/            — per-distribution JSON Schema with resolved refs

import { copyFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function copyAllJson(srcDir, dstDir, label) {
  if (!existsSync(srcDir)) {
    console.error(`${label}/ missing — skipping (run the matching build script first).`);
    return 0;
  }
  mkdirSync(dstDir, { recursive: true });
  let copied = 0;
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith(".json")) continue;
    copyFileSync(join(srcDir, f), join(dstDir, f));
    copied++;
  }
  return copied;
}

const outDir =
  process.argv.find((a) => a.startsWith("--outDir="))?.slice("--outDir=".length) ?? "out";

const distros = copyAllJson(
  resolve(root, "schemas", "distributions"),
  resolve(root, outDir, "schemas", "distributions"),
  "schemas/distributions",
);
console.log(`copied ${distros} distribution indexes to ${outDir}/schemas/distributions/`);

const json = copyAllJson(
  resolve(root, "schemas", "json"),
  resolve(root, outDir, "schemas", "json"),
  "schemas/json",
);
console.log(`copied ${json} per-distribution JSON Schemas to ${outDir}/schemas/json/`);
