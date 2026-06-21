# Releasing `otelcol-lang`

Releasing is **two phases**: _prepare_ (mutate the repo, commit, tag) and _publish_ (ship the tagged version to the registries). They are deliberately separate: preparing never publishes, and publishing never bumps a version.

```
edit CHANGELOG  →  make release-patch  →  git push --follow-tags  →  make publish
   (Unreleased)        (prepare)              (share)                  (publish)
```

## One source of truth for the version

A release ships from **three** version sources that MUST move in lockstep:

| Source                                  | Drives                                  |
| --------------------------------------- | --------------------------------------- |
| `package.json` (+ `package-lock.json`)  | VS Code extension **and** the npm `otelcol-language-server` binary |
| `editors/jetbrains/gradle.properties`   | the JetBrains plugin (`pluginVersion`)  |

If they diverge, the JetBrains / Helix / Zed editors end up pinned to a stale LSP. `scripts/prepare-release.sh` is the **only** place a version is bumped, so all three always agree. Never run `npm version` by hand for a release.

## Prerequisites (publish phase only)

Authenticate against each registry, either by logging in once or exporting a token:

| Registry            | Token env var                  | Interactive login        |
| ------------------- | ------------------------------ | ------------------------ |
| VS Code Marketplace | `VSCE_PAT`                     | `npx vsce login otelery` |
| npm                 | `NPM_TOKEN`                    | `npm login`              |
| JetBrains           | `JETBRAINS_MARKETPLACE_TOKEN`  | Token only; generate at https://plugins.jetbrains.com/author/me/tokens |

## Phase 1: Prepare

1. Make sure the working tree is clean and you're on the branch you want to release from.
2. Edit `CHANGELOG.md`: move the notable changes into the `## [Unreleased]` section under the right headings (Added / Changed / Deprecated / Removed / Fixed / Security). Leave empty headings empty; the script prunes them.
3. Run one of:

   ```sh
   make release-patch      # 0.3.0 → 0.3.1
   make release-minor      # 0.3.0 → 0.4.0
   make release-major      # 0.3.0 → 1.0.0
   ```

   For an explicit version, call the script directly:

   ```sh
   scripts/prepare-release.sh 0.5.0
   ```

`scripts/prepare-release.sh` then, in order:

- validates the version and that the tree is clean,
- rewrites `CHANGELOG.md`: `## [Unreleased]` → `## [X.Y.Z] - <today>`, and inserts a fresh empty `## [Unreleased]` template,
- bumps all three version sources (`npm version --no-git-tag-version` + `sed` on `gradle.properties`),
- runs **`make check`** (all quality gates; fails the release if anything is red),
- commits `chore(release): X.Y.Z` and tags **`vX.Y.Z`**.

Nothing is pushed or published. To undo before pushing:

```sh
git tag -d vX.Y.Z && git reset --hard HEAD~1
```

## Phase 2: Publish

1. Push the commit and tag:

   ```sh
   git push --follow-tags        # or: git push && git push --tags
   ```

2. Publish the prepared version to the automated registries:

   ```sh
   make publish                  # VS Code Marketplace → npm → JetBrains
   ```

   `make publish` runs `release-guard` first: it refuses to publish unless the working tree is clean **and** `HEAD` is exactly the `vX.Y.Z` tag matching `package.json`. This makes it impossible to ship an unprepared version. The individual `make publish-vscode` / `publish-npm` / `publish-jetbrains` targets are guarded the same way.

3. Zed and Helix have no automated registry upload; `make publish` prints the reminder, and the targets print the manual steps:

   ```sh
   make publish-zed              # open a PR against zed-industries/extensions
   make publish-helix            # ship the tarball; users extract it themselves
   ```

## Conventions

- **Tags:** `vX.Y.Z` (with the `v` prefix).
- **Changelog:** [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/).
- **Commit:** `chore(release): X.Y.Z`.
