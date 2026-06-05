// Tokenizer tests for the env-var / confmap substitution injection grammar.
//
// Loads the project's TextMate grammar(s) through vscode-textmate +
// vscode-oniguruma — the same engine VS Code uses — and asserts that
// ${env:VAR}, ${env:VAR:-default}, other confmap providers, and the legacy
// ${VAR} form produce the expected scope stacks. Catches regressions if the
// regex or scope names drift.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// vscode-oniguruma and vscode-textmate ship as CommonJS modules; the API
// lives under the default export when consumed from ESM.
const oniguruma = (await import("vscode-oniguruma")).default;
const vsctm = (await import("vscode-textmate")).default;

const wasmBin = readFileSync(resolve(root, "node_modules/vscode-oniguruma/release/onig.wasm"));
await oniguruma.loadWASM(wasmBin.buffer);

const onigLib = Promise.resolve({
  createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
  createOnigString: (s) => new oniguruma.OnigString(s),
});

const grammarRoot = JSON.parse(
  readFileSync(resolve(root, "syntaxes/otelcol-yaml.tmLanguage.json"), "utf8"),
);
const grammarInjection = JSON.parse(
  readFileSync(resolve(root, "syntaxes/otelcol-substitution.injection.json"), "utf8"),
);
const grammarOttl = JSON.parse(
  readFileSync(resolve(root, "syntaxes/ottl.tmLanguage.json"), "utf8"),
);

// Minimal stand-in for source.yaml so we can verify the injection still fires
// inside a YAML double-quoted string context (the L:source.yaml.otelcol
// selector should match any stack containing the host scope).
const grammarYamlStub = {
  scopeName: "source.yaml",
  patterns: [
    {
      begin: '"',
      end: '"',
      name: "string.quoted.double.yaml",
    },
  ],
};

const registry = new vsctm.Registry({
  onigLib,
  loadGrammar: async (scopeName) => {
    if (scopeName === "source.yaml.otelcol") return grammarRoot;
    if (scopeName === "source.yaml.otelcol.substitution") return grammarInjection;
    if (scopeName === "source.ottl") return grammarOttl;
    if (scopeName === "source.yaml") return grammarYamlStub;
    return null;
  },
  getInjections: (scopeName) => {
    if (scopeName === "source.yaml.otelcol") return ["source.yaml.otelcol.substitution"];
    return undefined;
  },
});

let grammar;
before(async () => {
  grammar = await registry.loadGrammar("source.yaml.otelcol");
  assert.ok(grammar, "failed to load source.yaml.otelcol grammar");
});

function tokenize(line) {
  const result = grammar.tokenizeLine(line, null);
  return result.tokens.map((t) => ({
    text: line.substring(t.startIndex, t.endIndex),
    scopes: t.scopes,
  }));
}

// Multi-line tokenizer that threads the rule-stack across lines so
// block-spanning rules (ottl-block-sequence, multi-line strings) can be
// exercised. Returns a flat array of {line, lineNo, text, scopes}.
function tokenizeLines(text) {
  const lines = text.split("\n");
  let state = null;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const r = grammar.tokenizeLine(line, state);
    state = r.ruleStack;
    for (const t of r.tokens) {
      out.push({
        lineNo: i,
        line,
        text: line.substring(t.startIndex, t.endIndex),
        scopes: t.scopes,
      });
    }
  }
  return out;
}

function findAll(tokens, text) {
  return tokens.filter((t) => t.text === text);
}

function findWithScope(tokens, text, scope) {
  return tokens.find((t) => t.text === text && hasScope(t, scope));
}

function find(tokens, text) {
  const t = tokens.find((tok) => tok.text === text);
  if (!t)
    throw new Error(
      `no token with text "${text}" in [${tokens.map((x) => JSON.stringify(x.text)).join(", ")}]`,
    );
  return t;
}

function hasScope(token, scope) {
  return token.scopes.includes(scope);
}

// ─── ${env:VAR:-default} in a quoted string ─────────────────────────────

describe("confmap substitution — env with default, quoted", () => {
  const line = '        username: "${env:KAFKA_USER:-otelcol}"';
  let tokens;
  before(() => {
    tokens = tokenize(line);
  });

  it("opens with ${ punctuation scope", () => {
    const t = find(tokens, "${");
    assert.ok(
      hasScope(t, "punctuation.definition.variable.begin.otelcol"),
      `expected begin-punct scope; got ${JSON.stringify(t.scopes)}`,
    );
  });

  it("'env' scheme gets support.function.builtin scope", () => {
    const t = find(tokens, "env");
    assert.ok(
      hasScope(t, "support.function.builtin.otelcol"),
      `expected scheme scope; got ${JSON.stringify(t.scopes)}`,
    );
  });

  it("variable name gets variable.other scope", () => {
    const t = find(tokens, "KAFKA_USER");
    assert.ok(
      hasScope(t, "variable.other.otelcol"),
      `expected variable.other scope; got ${JSON.stringify(t.scopes)}`,
    );
  });

  it(":- default operator gets keyword.operator.default scope", () => {
    const t = find(tokens, ":-");
    assert.ok(
      hasScope(t, "keyword.operator.default.otelcol"),
      `expected default-operator scope; got ${JSON.stringify(t.scopes)}`,
    );
  });

  it("default literal gets string.unquoted.default scope", () => {
    // The 'otelcol' here is the default value INSIDE the substitution, not
    // the surrounding YAML language tag — distinguishable by scope.
    const defaultToken = tokens.find(
      (t) => t.text === "otelcol" && hasScope(t, "string.unquoted.default.otelcol"),
    );
    assert.ok(
      defaultToken,
      `no 'otelcol' token with default-string scope; tokens: ${JSON.stringify(
        tokens.map((x) => ({ t: x.text, s: x.scopes.slice(-2) })),
      )}`,
    );
  });

  it("closes with } punctuation scope", () => {
    const t = find(tokens, "}");
    assert.ok(
      hasScope(t, "punctuation.definition.variable.end.otelcol"),
      `expected end-punct scope; got ${JSON.stringify(t.scopes)}`,
    );
  });

  it("wraps substitution in meta.variable.substitution scope", () => {
    const t = find(tokens, "env");
    assert.ok(
      hasScope(t, "meta.variable.substitution.otelcol"),
      `expected meta wrapper; got ${JSON.stringify(t.scopes)}`,
    );
  });

  it("injection composes with quoted-string host scope", () => {
    // The 'env' token is inside the YAML double-quoted string per the stub
    // grammar — both scopes must be present at once.
    const t = find(tokens, "env");
    assert.ok(
      hasScope(t, "string.quoted.double.yaml"),
      `expected host string scope on injected token; got ${JSON.stringify(t.scopes)}`,
    );
  });
});

// ─── ${env:VAR} unquoted ────────────────────────────────────────────────

describe("confmap substitution — env, unquoted", () => {
  const line = "      x-tenant-id: ${env:TENANT_ID}";
  let tokens;
  before(() => {
    tokens = tokenize(line);
  });

  it("'env' scheme gets support.function.builtin scope (no host string scope)", () => {
    const t = find(tokens, "env");
    assert.ok(hasScope(t, "support.function.builtin.otelcol"));
    assert.ok(
      !hasScope(t, "string.quoted.double.yaml"),
      "unquoted form must not carry a string scope",
    );
  });

  it("variable name gets variable.other scope", () => {
    const t = find(tokens, "TENANT_ID");
    assert.ok(hasScope(t, "variable.other.otelcol"));
  });
});

// ─── adjacent substitutions joined by ':' (host:port pattern) ──────────

describe("confmap substitution — two adjacent ${env:…} joined by ':'", () => {
  // The exact construct from examples/env-vars/otelcol-config.yaml: two
  // substitutions separated by a literal colon. The colon must not bleed
  // into either substitution's scope — each ${...} must close cleanly
  // before the next begins, and BOTH variable bodies must carry our
  // variable.other scope.
  const line = "        endpoint: ${env:OTLP_GRPC_HOST}:${env:OTLP_GRPC_PORT}";
  let tokens;
  before(() => {
    tokens = tokenize(line);
  });

  it("the literal ':' between '}' and '${' is NOT inside a substitution", () => {
    // Two '}' tokens, two '${' tokens, three ':' tokens (the YAML map
    // separator after 'endpoint', the scheme separators inside each
    // substitution, and the literal between the two substitutions).
    // Identify the literal middle ':' as the one whose stack does NOT
    // include meta.variable.substitution.otelcol.
    const colons = tokens.filter((t) => t.text === ":");
    const middle = colons.find((t) => !hasScope(t, "meta.variable.substitution.otelcol"));
    assert.ok(
      middle,
      `expected one ':' outside any substitution; got ${JSON.stringify(
        colons.map((t) => t.scopes.slice(-2)),
      )}`,
    );
  });

  it("BOTH variable names carry variable.other.otelcol", () => {
    const host = find(tokens, "OTLP_GRPC_HOST");
    const port = find(tokens, "OTLP_GRPC_PORT");
    assert.ok(
      hasScope(host, "variable.other.otelcol"),
      `OTLP_GRPC_HOST missing variable scope; got ${JSON.stringify(host.scopes)}`,
    );
    assert.ok(
      hasScope(port, "variable.other.otelcol"),
      `OTLP_GRPC_PORT missing variable scope; got ${JSON.stringify(port.scopes)}`,
    );
  });

  it("BOTH 'env' schemes carry support.function.builtin.otelcol", () => {
    const envs = tokens.filter((t) => t.text === "env");
    assert.equal(envs.length, 2, "expected exactly two 'env' tokens");
    for (const t of envs) {
      assert.ok(
        hasScope(t, "support.function.builtin.otelcol"),
        `an 'env' token missing scheme scope; got ${JSON.stringify(t.scopes)}`,
      );
    }
  });

  it("exactly two opening '${' and two closing '}' carry punctuation scopes", () => {
    const opens = tokens.filter(
      (t) => t.text === "${" && hasScope(t, "punctuation.definition.variable.begin.otelcol"),
    );
    const closes = tokens.filter(
      (t) => t.text === "}" && hasScope(t, "punctuation.definition.variable.end.otelcol"),
    );
    assert.equal(opens.length, 2);
    assert.equal(closes.length, 2);
  });
});

// ─── other confmap providers ────────────────────────────────────────────

describe("confmap substitution — other providers", () => {
  it("recognises file: provider", () => {
    const tokens = tokenize("authorization: Bearer ${file:/etc/otel/token}");
    const t = find(tokens, "file");
    assert.ok(
      hasScope(t, "support.function.builtin.otelcol"),
      `expected scheme scope on 'file'; got ${JSON.stringify(t.scopes)}`,
    );
  });

  it("does NOT recognise unsupported schemes like 'yaml' or 'http'", () => {
    // These providers exist in the OTel docs but aren't part of the
    // mainstream collector distribution, so the grammar deliberately
    // leaves them untokenised to avoid false-positive highlighting.
    for (const scheme of ["yaml", "http", "https"]) {
      const tokens = tokenize(`x: \${${scheme}:something}`);
      const t = tokens.find((x) => x.text === scheme);
      assert.ok(
        !t || !hasScope(t, "support.function.builtin.otelcol"),
        `'${scheme}' must not be tagged as a confmap scheme; got ${JSON.stringify(t?.scopes)}`,
      );
    }
  });
});

// ─── legacy ${VAR} (no scheme) ──────────────────────────────────────────

describe("confmap substitution — legacy bare form", () => {
  it("marks ${VAR} body as invalid.deprecated", () => {
    const tokens = tokenize("password: ${KAFKA_PASS}");
    const t = find(tokens, "KAFKA_PASS");
    assert.ok(
      hasScope(t, "invalid.deprecated.otelcol"),
      `expected deprecated scope on legacy form; got ${JSON.stringify(t.scopes)}`,
    );
  });

  it("does NOT mark scheme form as deprecated", () => {
    const tokens = tokenize("user: ${env:USER}");
    const t = find(tokens, "USER");
    assert.ok(
      !hasScope(t, "invalid.deprecated.otelcol"),
      `scheme form must not carry deprecated scope; got ${JSON.stringify(t.scopes)}`,
    );
  });
});

// ─── negatives: don't over-match ────────────────────────────────────────

describe("confmap substitution — negative cases", () => {
  it("a bare $VAR (no braces) is NOT a substitution", () => {
    const tokens = tokenize("note: see $HOME for details");
    const t = tokens.find((x) => x.text === "$HOME");
    assert.ok(
      !t || !t.scopes.some((s) => s.startsWith("variable.other.otelcol")),
      `bare $VAR must not trigger substitution scopes; got ${JSON.stringify(t && t.scopes)}`,
    );
  });

  it("an unterminated ${... does not introduce substitution scopes on the line", () => {
    // No closing brace before EOL. The scheme rule begins on the line, but
    // without a } it stays open — the test is that no token on the line
    // claims the end-punctuation scope (no spurious }).
    const tokens = tokenize("broken: ${env:FOO");
    const hasEndPunct = tokens.some((t) =>
      hasScope(t, "punctuation.definition.variable.end.otelcol"),
    );
    assert.equal(
      hasEndPunct,
      false,
      `no end-punct should be emitted on an unterminated substitution; tokens: ${JSON.stringify(
        tokens.map((t) => t.text),
      )}`,
    );
  });

  it("a literal ${ with no scheme and no identifier yields no substitution scopes", () => {
    const tokens = tokenize("text: ${ not a substitution }");
    const hasSchemeScope = tokens.some((t) => hasScope(t, "support.function.builtin.otelcol"));
    assert.equal(hasSchemeScope, false);
  });
});

// ─── ottl-block-sequence: `statements:` / `conditions:` / etc. ──────────

describe("ottl-block-sequence: keys that introduce OTTL sequence values", () => {
  // The grammar covers a fixed allow-list of keys. Spot-check each
  // category emits the entity.name.tag scope on the key and treats
  // following list items as embedded OTTL.
  for (const key of [
    "statements",
    "conditions",
    "log_statements",
    "trace_statements",
    "metric_statements",
    "log_record",
    "span",
    "spanevent",
    "metric",
    "datapoint",
  ]) {
    it(`'${key}:' is tagged entity.name.tag.yaml and opens an OTTL block`, () => {
      const text = `processors:\n  filter:\n    ${key}:\n      - severity_number >= SEVERITY_NUMBER_WARN\n`;
      const tokens = tokenizeLines(text);

      const keyTok = findWithScope(tokens, key, "entity.name.tag.yaml");
      assert.ok(keyTok, `'${key}' key missing entity.name.tag.yaml scope`);

      // The list-item dash carries the YAML sequence-item punctuation.
      // The begin pattern (^\s*-\s+) captures indent + dash + trailing
      // whitespace as one token; match by scope, not by literal text.
      const dash = tokens.find((t) =>
        hasScope(t, "punctuation.definition.block.sequence.item.yaml"),
      );
      assert.ok(dash, "missing punctuation.definition.block.sequence.item.yaml on '- '");

      // The OTTL body lands in the embedded-block scope.
      const ottlBodyToken = tokens.find(
        (t) =>
          hasScope(t, "meta.embedded.block.ottl") &&
          hasScope(t, "entity.other.attribute-name.ottl") &&
          t.text === "severity_number",
      );
      assert.ok(
        ottlBodyToken,
        `expected 'severity_number' under meta.embedded.block.ottl with attribute scope`,
      );
    });
  }

  it("block ends when indent drops to or above the key's indent", () => {
    // After the block, a sibling YAML key must NOT be tagged as OTTL.
    const text = [
      "processors:",
      "  filter:",
      "    statements:",
      '      - set(attributes["a"], 1)',
      "    error_mode: ignore",
      "",
    ].join("\n");
    const tokens = tokenizeLines(text);

    // The 'set' token inside the block must carry meta.embedded.block.ottl.
    const setTok = tokens.find((t) => t.text === "set" && hasScope(t, "meta.embedded.block.ottl"));
    assert.ok(setTok, "expected 'set' inside the OTTL block");

    // After the block ends, the 'error_mode: ignore' line falls through to
    // the source.yaml stub and is left untokenised — but importantly, none
    // of its tokens carry meta.embedded.block.ottl.
    const errLineTokens = tokens.filter((t) => t.line.includes("error_mode"));
    assert.ok(errLineTokens.length > 0, "missing tokens for the error_mode line");
    for (const t of errLineTokens) {
      assert.ok(
        !hasScope(t, "meta.embedded.block.ottl"),
        `'error_mode' line wrongly tagged as embedded OTTL: ${JSON.stringify(t.scopes)}`,
      );
    }
  });

  it("OTTL in a double-quoted YAML scalar still resolves to source.ottl scopes", () => {
    // The yaml-quoted-string-ottl pattern strips the quotes (tagging them
    // as YAML string punctuation) and hands the contents to source.ottl,
    // which here tokenises 'true' as an OTTL boolean literal.
    const text = ["statements:", '  - "true"', ""].join("\n");
    const tokens = tokenizeLines(text);
    const trueTok = findWithScope(tokens, "true", "constant.language.boolean.ottl");
    assert.ok(trueTok, `'true' inside double-quoted YAML should be OTTL boolean`);
    assert.ok(hasScope(trueTok, "meta.embedded.block.ottl"));

    // The surrounding quotes are tagged as YAML string punctuation, NOT
    // as OTTL string punctuation — by design, since YAML owns the quotes.
    const quotes = tokens.filter(
      (t) =>
        t.text === '"' &&
        (hasScope(t, "punctuation.definition.string.begin.yaml") ||
          hasScope(t, "punctuation.definition.string.end.yaml")),
    );
    assert.equal(quotes.length, 2, "expected matching YAML string punctuation quotes");
  });
});

// ─── ottl-inline-scalar: `condition: …` / `statement: …` ───────────────

describe("ottl-inline-scalar: condition / statement single-line embeds", () => {
  it("'condition:' tags the key and treats the RHS as embedded OTTL", () => {
    const line = '      condition: attributes["http.status_code"] >= 400';
    const tokens = tokenize(line);

    const keyTok = findWithScope(tokens, "condition", "entity.name.tag.yaml");
    assert.ok(keyTok, "'condition' key missing entity.name.tag.yaml");

    const ge = findWithScope(tokens, ">=", "keyword.operator.comparison.ottl");
    assert.ok(ge, "'>=' should carry OTTL comparison scope");
    assert.ok(hasScope(ge, "meta.embedded.block.ottl"));

    const attr = findWithScope(tokens, "attributes", "entity.other.attribute-name.ottl");
    assert.ok(attr, "'attributes' should carry OTTL attribute-name scope");
  });

  it("'statement:' tags the key and tokenises the RHS as OTTL", () => {
    const line = '      statement: set(attributes["env"], "prod")';
    const tokens = tokenize(line);

    assert.ok(findWithScope(tokens, "statement", "entity.name.tag.yaml"));
    assert.ok(findWithScope(tokens, "set", "entity.name.function.editor.ottl"));

    // The string `"prod"` inside the embed: yaml-quoted-string-ottl owns
    // the quotes (so they get YAML string punctuation scopes inside the
    // embedded-OTTL block), and the inner text falls to source.ottl.
    const quoteOpens = tokens.filter(
      (t) =>
        t.text === '"' &&
        hasScope(t, "meta.embedded.block.ottl") &&
        hasScope(t, "punctuation.definition.string.begin.yaml"),
    );
    assert.ok(quoteOpens.length >= 2, "expected matching opening YAML-string quotes inside OTTL");
  });

  it("trailing '# comment' on a condition: line is tagged as a YAML comment", () => {
    const tokens = tokenize("      condition: body != nil  # filter empties");
    const comment = tokens.find((t) => hasScope(t, "comment.line.number-sign.yaml"));
    assert.ok(comment, "trailing '# …' must carry the YAML comment scope");
  });
});

// ─── OTTL primitives (covered through the inline embed) ─────────────────

describe("OTTL grammar — full token coverage via condition: embed", () => {
  // One snippet exercises a wide range of OTTL constructs. Each token's
  // expected scope below comes from syntaxes/ottl.tmLanguage.json.
  const line =
    '      condition: Concat([resource.attributes["service.name"], "-", IsString(body)], ".") == "x-srv.true" and severity_number >= SEVERITY_NUMBER_WARN or not nil';
  let tokens;
  before(() => {
    tokens = tokenize(line);
  });

  const cases = [
    ["Concat", "entity.name.function.converter.ottl"],
    ["IsString", "entity.name.function.converter.ottl"],
    ["resource", "entity.other.attribute-name.ottl"],
    ["attributes", "entity.other.attribute-name.ottl"],
    ["body", "entity.other.attribute-name.ottl"],
    ["severity_number", "entity.other.attribute-name.ottl"],
    ["SEVERITY_NUMBER_WARN", "constant.other.enum.ottl"],
    ["where", null], // not present here — just sanity-check we didn't misclassify
    ["and", "keyword.operator.logical.ottl"],
    ["or", "keyword.operator.logical.ottl"],
    ["not", "keyword.operator.logical.ottl"],
    ["nil", "constant.language.nil.ottl"],
    ["==", "keyword.operator.comparison.ottl"],
    [">=", "keyword.operator.comparison.ottl"],
    ["(", "punctuation.section.parens.begin.ottl"],
    [")", "punctuation.section.parens.end.ottl"],
    ["[", "punctuation.section.brackets.begin.ottl"],
    ["]", "punctuation.section.brackets.end.ottl"],
    [",", "punctuation.separator.comma.ottl"],
    [".", "punctuation.accessor.dot.ottl"],
  ];

  for (const [text, scope] of cases) {
    if (scope === null) {
      it(`'${text}' is not in this snippet — sanity-skip`, () => {
        assert.equal(findAll(tokens, text).length, 0, `unexpectedly found '${text}'`);
      });
      continue;
    }
    it(`'${text}' carries ${scope}`, () => {
      const t = findWithScope(tokens, text, scope);
      assert.ok(
        t,
        `no '${text}' with scope ${scope}; saw ${JSON.stringify(
          findAll(tokens, text).map((x) => x.scopes.slice(-3)),
        )}`,
      );
      assert.ok(
        hasScope(t, "meta.embedded.block.ottl"),
        `'${text}' should be inside meta.embedded.block.ottl`,
      );
    });
  }

  it("editor function (lowercase before '(') gets entity.name.function.editor.ottl", () => {
    const tokens2 = tokenize('      statement: set(attributes["a"], 1)');
    assert.ok(findWithScope(tokens2, "set", "entity.name.function.editor.ottl"));
  });

  it("numeric literals: integer, float, hex bytes all classify distinctly", () => {
    const t1 = tokenize("      condition: x == 42");
    assert.ok(findWithScope(t1, "42", "constant.numeric.integer.ottl"));

    const t2 = tokenize("      condition: x == 3.14");
    assert.ok(findWithScope(t2, "3.14", "constant.numeric.float.ottl"));

    const t3 = tokenize("      condition: x == 0xFF");
    assert.ok(findWithScope(t3, "0xFF", "constant.numeric.bytes.ottl"));
  });

  it("boolean literals carry constant.language.boolean.ottl", () => {
    const t = tokenize("      condition: flag == true");
    assert.ok(findWithScope(t, "true", "constant.language.boolean.ottl"));
  });

  it("line and block comments inside OTTL", () => {
    // OTTL line comment (//) inside an inline embed.
    const line1 = "      condition: x == 1  // never";
    const tokens1 = tokenize(line1);
    // The OTTL comment rule fires before the trailing YAML '#' rule;
    // here there's no '#' so just check the // comment.
    const comm = tokens1.find((t) => hasScope(t, "comment.line.double-slash.ottl"));
    assert.ok(comm, "expected OTTL // comment scope");
  });
});

// ─── injection composes inside embedded OTTL ────────────────────────────

describe("env-var injection inside embedded OTTL", () => {
  it("`${env:VAR}` inside an OTTL statement body still carries substitution scopes", () => {
    // Realistic mixed case: the value of a statement references an env var.
    const line = '      statement: set(attributes["region"], "${env:REGION:-us-east-1}")';
    const tokens = tokenize(line);

    // The 'env' scheme inside the OTTL string scope.
    const envTok = findWithScope(tokens, "env", "support.function.builtin.otelcol");
    assert.ok(envTok, "env scheme inside embedded OTTL missed substitution scope");

    // The default literal is still tagged.
    const defaultTok = tokens.find(
      (t) => t.text === "us-east-1" && hasScope(t, "string.unquoted.default.otelcol"),
    );
    assert.ok(defaultTok, "default literal inside embedded OTTL missed scope");
  });
});

// ─── YAML host sanity checks ────────────────────────────────────────────

describe("YAML host: comments and quoted strings still work", () => {
  it("a YAML '#' comment line is recognised by the stub host", () => {
    // Our test stub for source.yaml doesn't model comments, so we only
    // verify the otelcol grammar does not eat the '#' or claim a
    // substitution scope for it.
    const tokens = tokenize("# this is a comment");
    assert.ok(
      !tokens.some((t) => t.scopes.some((s) => s.startsWith("meta.variable.substitution.otelcol"))),
      "comment line wrongly tagged as substitution",
    );
  });

  it("an arbitrary YAML key/value line emits no substitution-specific scopes", () => {
    // The root scope source.yaml.otelcol is expected on every token; what
    // we want to guarantee is that the substitution machinery does NOT
    // fire on plain YAML.
    const tokens = tokenize("    endpoint: 0.0.0.0:4317");
    const forbidden = new Set([
      "meta.variable.substitution.otelcol",
      "support.function.builtin.otelcol",
      "variable.other.otelcol",
      "keyword.operator.default.otelcol",
      "string.unquoted.default.otelcol",
      "invalid.deprecated.otelcol",
    ]);
    for (const t of tokens) {
      for (const s of t.scopes) {
        assert.ok(!forbidden.has(s), `plain YAML token '${t.text}' got substitution scope '${s}'`);
      }
    }
  });
});
