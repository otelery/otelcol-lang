// Static validation of editors/zed/extension.toml.
// Catches Marketplace metadata regressions before `zed install`.

use std::fs;
use std::path::PathBuf;
use toml::Value;

fn extension_toml() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("extension.toml");
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    toml::from_str(&text).expect("extension.toml is valid TOML")
}

#[test]
fn id_is_otelcol() {
    let v = extension_toml();
    assert_eq!(v["id"].as_str(), Some("otelcol"));
}

#[test]
fn language_server_languages_match_config() {
    let v = extension_toml();
    let langs = v["language_servers"]["otelcol"]["languages"]
        .as_array()
        .expect("language_servers.otelcol.languages must be an array");
    assert!(
        langs
            .iter()
            .any(|x| x.as_str() == Some("OpenTelemetry Collector")),
        "expected language_servers.otelcol.languages to contain \"OpenTelemetry Collector\""
    );
}

#[test]
fn declares_yaml_grammar() {
    // Zed extensions can't reference the editor's built-in YAML grammar —
    // every tree-sitter grammar a language config names must be declared
    // here with a pinned repo + commit. zed-ansible does the same.
    // Without this, `grammar = "yaml"` resolves to nothing and the editor
    // renders the document as plain white text.
    let v = extension_toml();
    let yaml = v["grammars"]["yaml"]
        .as_table()
        .expect("[grammars.yaml] block required so languages/otelcol/config.toml can reference it");
    let repo = yaml["repository"].as_str().unwrap_or("");
    assert!(
        repo.contains("tree-sitter-yaml"),
        "grammars.yaml.repository must point at a tree-sitter-yaml repo, got {repo:?}"
    );
    assert!(
        yaml.get("commit").and_then(|c| c.as_str()).is_some(),
        "grammars.yaml.commit must be pinned so the WASM build is reproducible"
    );
}
