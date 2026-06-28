#!/usr/bin/env bash
# Smoke-test the packaged Zed extension tarball produced by `make package-zed`.
# Asserts the tarball carries everything the zed-industries/extensions registry
# build needs, and that its declared version matches the release version. This
# is the closest thing to an end-to-end check without a headless Zed harness.
set -euo pipefail

usage() {
  echo "Usage: $0 <tarball.tar.gz> <expected-version>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
TARBALL="$1"
EXPECTED_VERSION="$2"

[[ -f "$TARBALL" ]] || {
  echo "zed-package-smoke: tarball not found: $TARBALL" >&2
  exit 1
}

listing=$(tar tzf "$TARBALL")

# Every artefact the registry build (and a dev install) needs.
required=(
  "extension.toml"
  "languages/"
  "icon.svg"
  "LICENSE"
  "otelcol_zed.wasm"
)
for entry in "${required[@]}"; do
  if ! grep -q -- "$entry" <<<"$listing"; then
    echo "zed-package-smoke: missing '$entry' in $TARBALL" >&2
    echo "--- tarball contents ---" >&2
    echo "$listing" >&2
    exit 1
  fi
done

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
tar xzf "$TARBALL" -C "$workdir"

# extension.toml version must match the release version (lockstep guard).
toml_version=$(awk -F'"' '/^version[[:space:]]*=/{print $2; exit}' "$workdir/extension.toml")
if [[ "$toml_version" != "$EXPECTED_VERSION" ]]; then
  echo "zed-package-smoke: extension.toml version '$toml_version' != expected '$EXPECTED_VERSION'" >&2
  exit 1
fi

# The compiled WASM must be a real wasm module (magic bytes: 0x00 'a' 's' 'm').
wasm="$workdir/otelcol_zed.wasm"
[[ -s "$wasm" ]] || {
  echo "zed-package-smoke: otelcol_zed.wasm is empty" >&2
  exit 1
}
magic=$(head -c 4 "$wasm" | od -An -tx1 | tr -d ' \n')
if [[ "$magic" != "0061736d" ]]; then
  echo "zed-package-smoke: otelcol_zed.wasm has bad magic bytes (got $magic, want 0061736d)" >&2
  exit 1
fi

echo "zed-package-smoke: OK ($TARBALL, version $EXPECTED_VERSION, wasm verified)"
