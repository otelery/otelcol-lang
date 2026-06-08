// Static validation of
// languages/otelcol/semantic_token_rules.json.
//
// The server (src/server/semantic-tokens.ts) emits exactly two token
// types (class, namespace) and two modifiers (declaration, deprecated).
// If anyone changes that legend, these tests should fail so the Zed
// styling file gets updated in lock-step.

use std::fs;
use std::path::PathBuf;
use toml::Value;

fn rules_json() -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("languages")
        .join("otelcol")
        .join("semantic_token_rules.json");
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    // Allow JSONC comments (//) — Zed parses these, but serde_json doesn't.
    let stripped: String = text
        .lines()
        .map(|l| {
            // Crude but adequate for our hand-authored file: only strip
            // lines whose first non-whitespace chars are `//`.
            if l.trim_start().starts_with("//") { "" } else { l }
        })
        .collect::<Vec<_>>()
        .join("\n");
    serde_json::from_str(&stripped)
        .unwrap_or_else(|e| panic!("semantic_token_rules.json is not valid JSON: {e}"))
}

fn config_grammar() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("languages")
        .join("otelcol")
        .join("config.toml");
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{e}"));
    toml::from_str(&text).unwrap()
}

#[test]
fn rules_file_parses_and_is_non_empty() {
    let arr = rules_json();
    let v = arr.as_array().expect("top level must be a JSON array");
    assert!(!v.is_empty(), "must contain at least one rule");
}

#[test]
fn declaration_deprecated_rule_marks_unused_loudly() {
    // The whole point of the file: unused component definitions must
    // get a visually distinct treatment, not just inherit @property.
    let arr = rules_json();
    let rules = arr.as_array().unwrap();
    let rule = rules
        .iter()
        .find(|r| {
            r["token_type"].as_str() == Some("class")
                && r["token_modifiers"]
                    .as_array()
                    .map(|m| {
                        m.iter().any(|x| x.as_str() == Some("declaration"))
                            && m.iter().any(|x| x.as_str() == Some("deprecated"))
                    })
                    .unwrap_or(false)
        })
        .expect("no rule for class + [declaration, deprecated]");
    let strike = rule
        .get("strikethrough")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let italic = rule
        .get("font_style")
        .and_then(|v| v.as_str())
        .map(|s| s == "italic")
        .unwrap_or(false);
    assert!(
        strike || italic,
        "unused-component rule must apply strikethrough or italic so users notice — got {rule}"
    );
}

#[test]
fn declaration_rule_emphasises_used_component() {
    let arr = rules_json();
    let rules = arr.as_array().unwrap();
    let rule = rules
        .iter()
        .find(|r| {
            r["token_type"].as_str() == Some("class")
                && r["token_modifiers"]
                    .as_array()
                    .map(|m| {
                        m.len() == 1 && m.iter().any(|x| x.as_str() == Some("declaration"))
                    })
                    .unwrap_or(false)
        })
        .expect("no rule for class + [declaration]");
    let weight = rule.get("font_weight").and_then(|v| v.as_str());
    assert_eq!(
        weight,
        Some("bold"),
        "used-component definitions should render bold for symmetry with the unused-strikethrough rule — got {rule}"
    );
}

#[test]
fn grammar_is_still_yaml() {
    // Sanity: the rules file is meaningless if the language isn't
    // actually parsing YAML.
    let v = config_grammar();
    assert_eq!(v["grammar"].as_str(), Some("yaml"));
}
