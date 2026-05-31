#!/usr/bin/env node
// Populate ./schemas/ from a sibling otelcol-schemas checkout so the
// existing copy-schemas.mjs (which copies in-tree schemas/ into dist/)
// keeps working unchanged.
//
// Source resolution:
//   1. process.env.OTELCOL_SCHEMAS_PATH (absolute or relative to cwd)
//   2. ../otelcol-schemas/        (sibling of this repo)
//   3. ../otelcol-schemas-release/ (staging sibling, useful pre-publish)
//
// Subdirectories synced (mirrors what copy-schemas.mjs expects):
//   schemas/distributions/*.json
//   schemas/json/*.json
//   schemas/json/_shared/*.json
//
// Exits non-zero with a clear message if no source can be found.

import { copyFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const candidates = [
  process.env.OTELCOL_SCHEMAS_PATH ? resolve(process.cwd(), process.env.OTELCOL_SCHEMAS_PATH) : null,
  resolve(repoRoot, "..", "otelcol-schemas"),
  resolve(repoRoot, "..", "otelcol-schemas-release"),
].filter(Boolean);

const source = candidates.find(p => existsSync(join(p, "schemas", "distributions")));

if (!source) {
  console.error("sync-schemas: could not locate otelcol-schemas checkout.");
  console.error("");
  console.error("Tried:");
  for (const p of candidates) console.error(`  - ${p}`);
  console.error("");
  console.error("Set OTELCOL_SCHEMAS_PATH to point at a built otelcol-schemas checkout,");
  console.error("or clone it as a sibling directory: https://github.com/otelery/otelcol-schemas");
  console.error("In that checkout run: npm install && npm run build:all");
  process.exit(1);
}

function syncDir(srcDir, dstDir, label) {
  if (!existsSync(srcDir)) {
    console.error(`sync-schemas: ${label} missing in source (${srcDir}). Run build:all in otelcol-schemas first.`);
    process.exit(1);
  }
  if (existsSync(dstDir)) rmSync(dstDir, { recursive: true, force: true });
  mkdirSync(dstDir, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const dstPath = join(dstDir, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copied += syncDir(srcPath, dstPath, `${label}/${entry}`);
    } else if (entry.endsWith(".json")) {
      copyFileSync(srcPath, dstPath);
      copied++;
    }
  }
  return copied;
}

console.log(`sync-schemas: copying from ${source}`);

const distros = syncDir(
  resolve(source, "schemas", "distributions"),
  resolve(repoRoot, "schemas", "distributions"),
  "schemas/distributions",
);
console.log(`  ${distros} distribution indices`);

const json = syncDir(
  resolve(source, "schemas", "json"),
  resolve(repoRoot, "schemas", "json"),
  "schemas/json",
);
console.log(`  ${json} JSON Schema files (incl. catalog + _shared)`);
