#!/usr/bin/env node
// Headless hover probe. Usage:
//   node scripts/hover-probe.mjs <file.yaml> <line:col>      (1-based)
//   node scripts/hover-probe.mjs <file.yaml> '/key_name'     (locate key)

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const { buildModel } = await import(resolve(root, "out/server/yaml-model.js"));
const { loadComponents } = await import(resolve(root, "out/server/components.js"));
const { hover } = await import(resolve(root, "out/server/hover.js"));

const filePath = process.argv[2];
const target = process.argv[3];
if (!filePath || !target) {
  console.error("usage: hover-probe.mjs <file.yaml> {<line>:<col> | /key}");
  process.exit(1);
}
const text = readFileSync(filePath, "utf8");
const lines = text.split("\n");

let line, character;
if (target.startsWith("/")) {
  const key = target.slice(1);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf(key);
    if (idx >= 0) {
      line = i;
      character = idx + Math.floor(key.length / 2);
      found = true;
      break;
    }
  }
  if (!found) {
    console.error(`key "${key}" not found`);
    process.exit(1);
  }
} else {
  const [l, c] = target.split(":").map(Number);
  line = l - 1;
  character = c - 1;
}

const model = buildModel(text);
const idx = loadComponents(resolve(root, "out", "server"), "otelcol-contrib");
const h = hover(model, idx, { line, character });
console.log(`pos: L${line + 1}:${character + 1} (line text: ${JSON.stringify(lines[line])})`);
if (!h) {
  console.log("(no hover)");
} else {
  console.log(`range: ${JSON.stringify(h.range)}`);
  console.log("---");
  console.log(
    typeof h.contents === "object" && "value" in h.contents ? h.contents.value : h.contents,
  );
}
