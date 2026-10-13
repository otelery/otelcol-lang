#!/usr/bin/env node
// Guards the invariant that runtime code (extension + server) loads its
// peers from `dist/`, never from `out/`. This invariant exists because:
//
//   - esbuild populates `editors/vscode/dist/` (the runtime / VSIX output).
//   - tsc populates `out/` (test infrastructure only).
//
// A single forgotten `path.join("out", ...)` inside src/extension/ silently
// reroutes the running extension to load a server compiled by a tool that
// nothing in the dev loop refreshes - exactly the bug we hit while wiring
// semantic tokens. This script catches it before it ships.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const targets = [join(root, "editors", "vscode", "src"), join(root, "src", "server")];

// Matches: `"out"` or `'out'` inside a path.join / asAbsolutePath / require / import argument.
// The quoted literal is the actionable signal - accidental ID references like
// `out_of_band` won't trip because they're identifiers, not strings.
const FORBIDDEN = /(?:path\.join|asAbsolutePath|require|import)\s*\([^)]*?["']out["']/;

const offenders = [];
for (const dir of targets) walk(dir);

// Dev-sandbox server paths hard-coded in build scripts must point at a file
// that exists in the repo. A stale path (e.g. after the extension root moved
// to editors/vscode/) otherwise only surfaces when someone launches the IDE.
// Requires the bundle, so `make test-unit` builds it first.
const missing = [];
const gradleFile = join(root, "editors", "jetbrains", "build.gradle.kts");
for (const [, rel] of readFileSync(gradleFile, "utf8").matchAll(
  /File\(repoRoot,\s*"([^"]+\.js)"\)/g,
)) {
  if (!existsSync(join(root, rel))) missing.push(`${relative(root, gradleFile)}: ${rel}`);
}
if (missing.length) {
  console.error("check-runtime-paths: build script references server files that do not exist:");
  for (const m of missing) console.error(`  ${m}`);
  console.error("\nRun `make bundle`, or fix the path (the bundle lives in editors/vscode/dist/).");
  process.exit(1);
}

if (offenders.length) {
  console.error("check-runtime-paths: runtime source references `out/` - must use `dist/`:");
  for (const { file, line, text } of offenders) {
    console.error(`  ${relative(root, file)}:${line}: ${text.trim()}`);
  }
  console.error(
    '\nRule: editors/vscode/src/ and src/server/ must never asAbsolutePath/require/import from "out".\n' +
      "      Runtime loads from dist/ (esbuild output). out/ is for tests only.",
  );
  process.exit(1);
}

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.isFile() && /\.(ts|js|mjs|cjs)$/.test(ent.name)) check(p);
  }
}

function check(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (FORBIDDEN.test(lines[i])) offenders.push({ file, line: i + 1, text: lines[i] });
  }
}
