#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <X.Y.Z>" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
fi

VERSION="$1"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "prepare-release: invalid version '$VERSION' (expected X.Y.Z)" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "prepare-release: working tree is not clean; commit or stash changes first" >&2
  exit 1
fi

if ! grep -qi '^##[[:space:]]*\[unreleased\]' CHANGELOG.md; then
  echo "prepare-release: CHANGELOG.md missing '## [Unreleased]' section" >&2
  exit 1
fi

if grep -q "^##[[:space:]]*\\[$VERSION\\][[:space:]]*-" CHANGELOG.md; then
  echo "prepare-release: version '$VERSION' already exists in CHANGELOG.md" >&2
  exit 1
fi

if git rev-parse --verify --quiet "refs/tags/v$VERSION" >/dev/null; then
  echo "prepare-release: git tag 'v$VERSION' already exists" >&2
  exit 1
fi

# Remove empty markdown level-3 subsections (e.g. "### Deprecated")
# when they contain only blank lines before the next ###/## heading or EOF.
sed -z -E -i '
  :clean
  s/(^|\n)###[^\n]*\n([[:space:]]*\n)*(###|##[[:space:]])/\1\3/g
  t clean
  :tail
  s/(^|\n)###[^\n]*\n([[:space:]]*\n)*$/\1/g
  t tail
' CHANGELOG.md

sed -i -E "0,/^##[[:space:]]*\[?unreleased\]?/I{
/^##[[:space:]]*\[?unreleased\]?/I{
s/^##[[:space:]]*\[?unreleased\]?/## [${VERSION}] - $(date +%F)/I

i\\
## [Unreleased]\\
\\
### Added\\
\\
### Changed\\
\\
### Deprecated\\
\\
### Removed\\
\\
### Fixed\\
\\
### Security\\

}
}" CHANGELOG.md

if git diff --quiet -- CHANGELOG.md; then
  echo "prepare-release: no changelog changes produced; aborting" >&2
  exit 1
fi

# Sync the single version source across registries: root package.json drives
# the VS Code extension + npm package; editors/jetbrains/gradle.properties
# drives the JetBrains plugin. They MUST move in lockstep or `make publish`
# will ship mismatched artefacts.
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
sed -i -E "s/^pluginVersion=.*/pluginVersion=${VERSION}/" editors/jetbrains/gradle.properties

echo "prepare-release: running quality checks (make check)"
if ! make check; then
  echo "prepare-release: quality checks failed; aborting release commit/tag. Please fix issues (including CHANGELOG.md formatting) and retry." >&2
  exit 1
fi

git add CHANGELOG.md package.json package-lock.json editors/jetbrains/gradle.properties
git commit -m "chore(release): ${VERSION}"
git tag "v$VERSION"

echo "Release prepared: commit + tag v$VERSION created locally."
echo "Push when ready: git push && git push --tags"
