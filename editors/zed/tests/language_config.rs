// Static validation of editors/zed/languages/otelcol/config.toml.

use std::fs;
use std::path::PathBuf;
use toml::Value;

fn language_config() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("languages")
        .join("otelcol")
        .join("config.toml");
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    toml::from_str(&text).expect("language config.toml is valid TOML")
}

#[test]
fn grammar_is_stock_yaml() {
    let v = language_config();
    assert_eq!(v["grammar"].as_str(), Some("yaml"));
}

#[test]
fn name_matches_extension() {
    let v = language_config();
    assert_eq!(v["name"].as_str(), Some("OpenTelemetry Collector"));
}

#[test]
fn path_suffixes_cover_documented_globs() {
    let v = language_config();
    let suffixes: Vec<&str> = v["path_suffixes"]
        .as_array()
        .expect("path_suffixes must be an array")
        .iter()
        .filter_map(|x| x.as_str())
        .collect();
    for expected in ["otelcol.yaml", "otelcol.yml"] {
        assert!(
            suffixes.contains(&expected),
            "path_suffixes missing {expected}: {suffixes:?}"
        );
    }
}

#[test]
fn path_suffixes_cover_sidecar_and_simple_example() {
    // Layer 1 of the Zed sniffing strategy: catch sniffer rule-2 (sidecar
    // basename) and the canonical example-file naming via path tails alone.
    let v = language_config();
    let suffixes: Vec<&str> = v["path_suffixes"]
        .as_array()
        .expect("path_suffixes must be an array")
        .iter()
        .filter_map(|x| x.as_str())
        .collect();
    for expected in [
        "otelcol.yaml",
        "otelcol-config.yaml",
        "otelcol-config.yml",
    ] {
        assert!(
            suffixes.contains(&expected),
            "path_suffixes missing {expected}: {suffixes:?}"
        );
    }
}

#[test]
fn first_line_pattern_matches_directive_and_markers() {
    // Spot-check `first_line_pattern` against representative head lines so
    // a regex regression here doesn't silently break content sniffing. We
    // parse with Rust `regex` (the same engine Zed uses).
    let v = language_config();
    let pat = v["first_line_pattern"]
        .as_str()
        .expect("first_line_pattern must be a string");
    let re = regex::Regex::new(pat).expect("first_line_pattern is a valid regex");

    let matches = [
        "# configset-otelcol: receivers.yaml exporters.yaml",
        "# otelcol",
        "#configset-otelcol: foo.yaml",
        "# opentelemetry-collector",
    ];
    for line in matches {
        assert!(re.is_match(line), "expected match for: {line:?}");
    }

    let non_matches = [
        "# some unrelated comment",
        "receivers:",
        "  # otelcol leading whitespace not first line",
    ];
    for line in non_matches {
        assert!(!re.is_match(line), "expected NO match for: {line:?}");
    }
}

#[test]
fn first_line_pattern_matches_configset_directive() {
    let v = language_config();
    let pat = v["first_line_pattern"]
        .as_str()
        .expect("first_line_pattern must be a string");
    assert!(
        pat.contains("configset-otelcol:"),
        "first_line_pattern must accept `# configset-otelcol:` directive — got {pat:?}"
    );
}
