// Static validation of the Zed tree-sitter query files.
// Symmetric with editors/helix/test/queries-syntax.test.mjs — keep
// the assertions in sync if either drifts.

use std::fs;
use std::path::PathBuf;

fn read_query(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("languages")
        .join("otelcol")
        .join(name);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn strip_noise(src: &str) -> String {
    // Drop `;`-prefixed line comments and double-quoted strings
    // before counting parens.
    let mut out = String::with_capacity(src.len());
    for line in src.lines() {
        let no_comment = line.splitn(2, ';').next().unwrap_or("");
        let mut in_string = false;
        let mut escape = false;
        for ch in no_comment.chars() {
            if escape {
                escape = false;
                continue;
            }
            if ch == '\\' && in_string {
                escape = true;
                continue;
            }
            if ch == '"' {
                in_string = !in_string;
                continue;
            }
            if !in_string {
                out.push(ch);
            }
        }
        out.push('\n');
    }
    out
}

fn paren_balance(src: &str) -> i32 {
    let mut depth: i32 = 0;
    for ch in strip_noise(src).chars() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if depth < 0 {
            return depth;
        }
    }
    depth
}

#[test]
fn highlights_has_core_yaml_captures() {
    // Zed does NOT honour Helix-style `; inherits: yaml` magic comments —
    // highlights.scm is the authoritative query set for this language.
    // A near-empty / inheritance-only file renders YAML as undifferentiated
    // plain text. Assert the core captures are present so a future
    // "let's just inherit" refactor fails loudly.
    let q = read_query("highlights.scm");
    for cap in [
        "@string",
        "@property",
        "@comment",
        "@number",
        "@boolean",
        "@punctuation.bracket",
        "@punctuation.delimiter",
    ] {
        assert!(
            q.contains(cap),
            "highlights.scm missing {cap} capture — Zed will render YAML as plain text"
        );
    }
    assert_eq!(paren_balance(&q), 0);
}

#[test]
fn injections_routes_ottl() {
    let q = read_query("injections.scm");
    assert!(q.contains("@injection.content"));
    assert!(
        q.contains("(#set! injection.language \"ottl\")"),
        "injections.scm must set injection.language = ottl"
    );
}

#[test]
fn injections_targets_known_keys() {
    let q = read_query("injections.scm");
    assert!(
        q.contains("(statements|conditions)"),
        "injections.scm must scope to statements/conditions keys"
    );
}

#[test]
fn injections_balanced_parens() {
    let q = read_query("injections.scm");
    assert_eq!(paren_balance(&q), 0);
}
