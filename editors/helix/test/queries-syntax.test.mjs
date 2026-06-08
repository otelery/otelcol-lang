// Static validation of the Helix tree-sitter query files. Pure string
// checks — no tree-sitter runtime — so it runs hermetically.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const queriesDir = resolve(__dirname, "..", "runtime", "queries", "otelcol");

function stripCommentsAndStrings(src) {
  // Drop `;`-prefixed line comments and double-quoted strings before
  // counting parens. Tree-sitter queries use both.
  return src
    .split("\n")
    .map((line) => line.replace(/;.*$/, ""))
    .join("\n")
    .replace(/"(?:[^"\\]|\\.)*"/g, "");
}

function parenBalance(src) {
  let depth = 0;
  for (const ch of stripCommentsAndStrings(src)) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return depth;
  }
  return depth;
}

describe("editors/helix/runtime/queries/otelcol", () => {
  const highlights = readFileSync(resolve(queriesDir, "highlights.scm"), "utf8");
  const injections = readFileSync(resolve(queriesDir, "injections.scm"), "utf8");

  it("highlights.scm inherits from the stock yaml query set", () => {
    assert.match(highlights, /;\s*inherits:\s*yaml/);
  });

  it("highlights.scm has balanced parens", () => {
    assert.equal(parenBalance(highlights), 0);
  });

  it("injections.scm captures @injection.content", () => {
    assert.match(injections, /@injection\.content/);
  });

  it("injections.scm targets statements/conditions keys", () => {
    assert.match(injections, /\(#match\?\s*@_key\s*"\^\(statements\|conditions\)\$"\)/);
  });

  it("injections.scm sets injection.language to ottl", () => {
    assert.match(injections, /\(#set!\s*injection\.language\s*"ottl"\)/);
  });

  it("injections.scm has balanced parens", () => {
    assert.equal(parenBalance(injections), 0);
  });
});
