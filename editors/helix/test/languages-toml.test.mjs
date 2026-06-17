// Static validation of editors/helix/languages.toml.
//
// No real TOML parser — the file is short, the assertions are about
// the presence of literal strings that drive Helix behaviour. Keeps
// the test dep-free (`node --test` only) so it runs anywhere.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tomlPath = resolve(__dirname, "..", "languages.toml");
const toml = readFileSync(tomlPath, "utf8");

describe("editors/helix/languages.toml", () => {
  it("registers the otelcol language server", () => {
    assert.match(toml, /\[language-server\.otelcol\]/);
    assert.match(toml, /command\s*=\s*"otelcol-language-server"/);
    assert.match(toml, /args\s*=\s*\[\s*"--stdio"\s*\]/);
  });

  it("declares the otelcol language with the stock yaml grammar", () => {
    assert.match(toml, /\[\[language\]\]/);
    assert.match(toml, /name\s*=\s*"otelcol"/);
    assert.match(toml, /grammar\s*=\s*"yaml"/);
    assert.match(toml, /language-servers\s*=\s*\[\s*"otelcol"\s*\]/);
  });

  it("matches the two documented file-types globs", () => {
    for (const glob of ["*.otelcol.yaml", "*.otelcol.yml"]) {
      assert.ok(
        toml.includes(`glob = "${glob}"`),
        `expected file-types glob "${glob}" in languages.toml`,
      );
    }
  });

  it("uses the configset.otelcol.yaml sidecar as a workspace root marker", () => {
    assert.match(toml, /roots\s*=\s*\[[^\]]*"configset\.otelcol\.yaml"/);
  });

  it("does NOT declare a custom [[grammar]] block (stock-yaml decision)", () => {
    assert.doesNotMatch(toml, /\[\[grammar\]\]/);
  });
});
