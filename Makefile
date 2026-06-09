.PHONY: help bootstrap tools install build bundle test test-unit test-integration test-vscode \
        lint lint-fix format format-check typecheck audit package-check check \
        clean distclean package package-vscode package-jetbrains package-zed package-helix \
        publish publish-vscode publish-npm publish-jetbrains publish-zed publish-helix \
        publish-patch publish-minor publish-major \
        check-versions upgrade-tools outdated test-stdio test-helix test-helix-integration test-jetbrains \
        test-zed test-editors build-jetbrains build-zed build-editors

# Runtime toolchains (node/rust/java/gradle/...) and npm CLI tools are all
# pinned in .mise.toml and installed into .ci-tools/ by `make bootstrap`.
MISE_VERSION            := 2026.6.0

# --- Read npm tool versions from .mise.toml ------------------------------------
# Versions live in .mise.toml under "npm:<pkg>" entries.  Bump there; a
# sentinel-filename change propagates automatically to `make tools`.
npm_v = $(shell grep -Fm1 '"npm:$(1)"' .mise.toml | awk -F'"' '{print $$4}')

OXLINT_VERSION          := $(call npm_v,oxlint)
OXFMT_VERSION           := $(call npm_v,oxfmt)
VSCE_VERSION            := $(call npm_v,@vscode/vsce)
TYPESCRIPT_VERSION      := $(call npm_v,typescript)
VSCODE_TEST_CLI_VERSION := $(call npm_v,@vscode/test-cli)

# --- mise-managed toolchain ---------------------------------------------------
# Versions live in .mise.toml; parse them once so a bump there propagates to
# the per-tool sentinel filenames below. Awk: print the first double-quoted
# value on the line matching `<key> =`.
mise_v = $(shell awk -F'"' '/^[[:space:]]*$(1)[[:space:]]*=/{print $$2; exit}' .mise.toml)
NODE_VERSION        := $(call mise_v,node)
BUN_VERSION         := $(call mise_v,bun)
RUST_VERSION        := $(call mise_v,rust)
JAVA_VERSION        := $(call mise_v,java)
GRADLE_VERSION      := $(call mise_v,gradle)
HELIX_VERSION       := $(call mise_v,helix)
TS_VERSION          := $(call mise_v,tree-sitter)
OSV_SCANNER_VERSION := $(call mise_v,osv-scanner)

# Sandbox mise into the project. ~/.local/share/mise stays untouched.
export MISE_DATA_DIR    := $(CURDIR)/.ci-tools/data
export MISE_CACHE_DIR   := $(CURDIR)/.ci-tools/cache
export MISE_STATE_DIR   := $(CURDIR)/.ci-tools/state
# Prevent the user's global mise config from leaking in (settings, plugins).
export MISE_GLOBAL_CONFIG_FILE := $(CURDIR)/.ci-tools/config.toml
# Pre-trust the project's .mise.toml. Without this, `make distclean` wipes the
# trust DB (under MISE_STATE_DIR), and the next bootstrap refuses to read the
# pinned tool versions.
export MISE_TRUSTED_CONFIG_PATHS := $(CURDIR)/.mise.toml
# Ensure mise itself is on PATH so sub-processes (e.g. npm lifecycle scripts) can find it.
export PATH             := $(CURDIR)/.ci-tools/bin:$(PATH)
MISE          := $(CURDIR)/.ci-tools/bin/mise
MISE_EXEC     := $(MISE) exec --

# Tool shorthands — every command goes through `mise exec` so the pinned
# .ci-tools/ versions win over anything in $PATH.
TSC          := $(MISE_EXEC) tsc
OXLINT       := $(MISE_EXEC) oxlint
OXFMT        := $(MISE_EXEC) oxfmt
VSCE         := $(MISE_EXEC) vsce
VSCODE_TEST  := $(MISE_EXEC) vscode-test
OSV_SCANNER  := $(MISE_EXEC) osv-scanner
NODE         := $(MISE_EXEC) node
NPM          := $(MISE_EXEC) npm
BUN          := $(MISE_EXEC) bun
CARGO        := $(MISE_EXEC) cargo
GRADLEW      := $(MISE_EXEC) gradle
JAVA         := $(MISE_EXEC) java
HX           := $(MISE_EXEC) hx
TREE_SITTER  := $(MISE_EXEC) tree-sitter

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- Bootstrap ----------------------------------------------------------------
# `make bootstrap` is the single entry point for a fresh checkout. It downloads
# mise into .ci-tools/bin/, then installs every pinned toolchain. Each tool gets
# a sentinel file `.ci-tools/<tool>-<version>` whose presence is the Make-level
# proxy for "installed at the right version". Bump a version in .mise.toml ⇒ the
# sentinel filename changes ⇒ the recipe re-runs.

tools: .ci-tools/node-$(NODE_VERSION) \
       .ci-tools/bun-$(BUN_VERSION) \
       .ci-tools/rust-wasm32-$(RUST_VERSION) \
       .ci-tools/java-$(JAVA_VERSION) \
       .ci-tools/gradle-$(GRADLE_VERSION) \
       .ci-tools/helix-$(HELIX_VERSION) \
       .ci-tools/tree-sitter-$(TS_VERSION) \
       .ci-tools/oxlint-$(OXLINT_VERSION) \
       .ci-tools/oxfmt-$(OXFMT_VERSION) \
       .ci-tools/vsce-$(VSCE_VERSION) \
       .ci-tools/typescript-$(TYPESCRIPT_VERSION) \
       .ci-tools/vscode-test-cli-$(VSCODE_TEST_CLI_VERSION) \
       .ci-tools/osv-scanner-$(OSV_SCANNER_VERSION)

bootstrap: tools ## Download mise and install all pinned toolchains into .ci-tools/

# Detect OS/arch in the conventions mise uses for its release assets.
# linux-{x64,arm64} / macos-{x64,arm64}.
MISE_OS       := $(shell uname -s | tr A-Z a-z | sed 's/darwin/macos/')
MISE_ARCH_RAW := $(shell uname -m)
ifeq ($(MISE_ARCH_RAW),x86_64)
  MISE_ARCH := x64
else ifeq ($(MISE_ARCH_RAW),amd64)
  MISE_ARCH := x64
else ifeq ($(MISE_ARCH_RAW),aarch64)
  MISE_ARCH := arm64
else ifeq ($(MISE_ARCH_RAW),arm64)
  MISE_ARCH := arm64
else
  $(error unsupported architecture: $(MISE_ARCH_RAW))
endif
MISE_URL := https://github.com/jdx/mise/releases/download/v$(MISE_VERSION)/mise-v$(MISE_VERSION)-$(MISE_OS)-$(MISE_ARCH).tar.gz

.ci-tools/mise-$(MISE_VERSION):
	@mkdir -p .ci-tools/bin
	@rm -f .ci-tools/mise-*
	@echo "→ downloading mise v$(MISE_VERSION) for $(MISE_OS)-$(MISE_ARCH)"
	curl -fsSL -o .ci-tools/mise.tar.gz $(MISE_URL)
	tar -xzf .ci-tools/mise.tar.gz -C .ci-tools/ --strip-components=2 mise/bin/mise
	mv .ci-tools/mise $(MISE)
	rm -f .ci-tools/mise.tar.gz
	@touch $@

# Per-tool sentinels. Same shape for every tool; the prerequisite on .mise.toml
# is belt-and-suspenders — version-in-filename already invalidates on bump.
.ci-tools/node-$(NODE_VERSION): .ci-tools/mise-$(MISE_VERSION) .mise.toml
	@rm -f .ci-tools/node-*
	$(MISE) install node@$(NODE_VERSION)
	@touch $@

.ci-tools/bun-$(BUN_VERSION): .ci-tools/mise-$(MISE_VERSION) .mise.toml
	@rm -f .ci-tools/bun-*
	$(MISE) install bun@$(BUN_VERSION)
	@touch $@

.ci-tools/rust-$(RUST_VERSION): .ci-tools/mise-$(MISE_VERSION) .mise.toml
	@rm -f .ci-tools/rust-* .ci-tools/rust-wasm32-*
	$(MISE) install rust@$(RUST_VERSION)
	@touch $@

.ci-tools/rust-wasm32-$(RUST_VERSION): .ci-tools/rust-$(RUST_VERSION)
	$(MISE_EXEC) rustup target add wasm32-wasip1
	@touch $@

.ci-tools/java-$(JAVA_VERSION): .ci-tools/mise-$(MISE_VERSION) .mise.toml
	@rm -f .ci-tools/java-*
	$(MISE) install java@$(JAVA_VERSION)
	@touch $@

.ci-tools/gradle-$(GRADLE_VERSION): .ci-tools/mise-$(MISE_VERSION) .mise.toml
	@rm -f .ci-tools/gradle-*
	$(MISE) install gradle@$(GRADLE_VERSION)
	@touch $@

.ci-tools/helix-$(HELIX_VERSION): .ci-tools/mise-$(MISE_VERSION) .mise.toml
	@rm -f .ci-tools/helix-*
	$(MISE) install helix@$(HELIX_VERSION)
	@touch $@

.ci-tools/tree-sitter-$(TS_VERSION): .ci-tools/mise-$(MISE_VERSION) .mise.toml
	@rm -f .ci-tools/tree-sitter-*
	$(MISE) install tree-sitter@$(TS_VERSION)
	@touch $@

# npm CLI tool sentinels — versions come from .mise.toml "npm:…" entries.
.ci-tools/oxlint-$(OXLINT_VERSION): .ci-tools/node-$(NODE_VERSION) .mise.toml
	@rm -f .ci-tools/oxlint-*
	$(MISE) install npm:oxlint@$(OXLINT_VERSION)
	@touch $@

.ci-tools/oxfmt-$(OXFMT_VERSION): .ci-tools/node-$(NODE_VERSION) .mise.toml
	@rm -f .ci-tools/oxfmt-*
	$(MISE) install npm:oxfmt@$(OXFMT_VERSION)
	@touch $@

.ci-tools/vsce-$(VSCE_VERSION): .ci-tools/node-$(NODE_VERSION) .mise.toml
	@rm -f .ci-tools/vsce-*
	$(MISE) install "npm:@vscode/vsce@$(VSCE_VERSION)"
	@touch $@

.ci-tools/typescript-$(TYPESCRIPT_VERSION): .ci-tools/node-$(NODE_VERSION) .mise.toml
	@rm -f .ci-tools/typescript-*
	$(MISE) install npm:typescript@$(TYPESCRIPT_VERSION)
	@touch $@

.ci-tools/vscode-test-cli-$(VSCODE_TEST_CLI_VERSION): .ci-tools/node-$(NODE_VERSION) .mise.toml
	@rm -f .ci-tools/vscode-test-cli-*
	$(MISE) install "npm:@vscode/test-cli@$(VSCODE_TEST_CLI_VERSION)"
	@touch $@

.ci-tools/osv-scanner-$(OSV_SCANNER_VERSION): .ci-tools/mise-$(MISE_VERSION) .mise.toml
	@rm -f .ci-tools/osv-scanner-*
	$(MISE) install osv-scanner@$(OSV_SCANNER_VERSION)
	@touch $@

# --- Project targets ----------------------------------------------------------

# node_modules sentinel — touched after every successful `npm install`. Any
# target needing project deps (esbuild, vsce, tsc against vscode types, …)
# depends on this; npm install only re-runs when package.json or
# package-lock.json change. distclean wipes .ci-tools/ which forces a fresh
# install. Don't depend on node_modules/ mtime — npm doesn't bump it reliably.
NPM_INSTALL_STAMP := .ci-tools/npm-install.stamp

$(NPM_INSTALL_STAMP): package.json package-lock.json | .ci-tools/node-$(NODE_VERSION)
	$(NPM) install
	@touch $@

install: $(NPM_INSTALL_STAMP) ## Install dependencies (npm install via sentinel). CI should call `npm ci` directly.

build: $(NPM_INSTALL_STAMP) ## Compile TS to out/ + copy schemas (for unit tests)
	$(TSC) -p .
	$(NODE) scripts/copy-schemas.mjs

bundle: $(NPM_INSTALL_STAMP) ## Bundle extension + server with esbuild to dist/ (for VS Code packaging + integration tests)
	$(NODE) esbuild.js --production

test: test-unit test-editors ## Run unit + per-editor tests (VS Code is one of the editors)

test-unit: build ## LSP modules in isolation (node --test, fast)
	$(NODE) scripts/check-runtime-paths.mjs
	$(NODE) --test test/run-tests.mjs test/*.test.mjs

test-vscode: bundle ## VS Code Extension Host integration tests (~30s)
	$(TSC) -p editors/vscode/tsconfig.test.json
	$(VSCODE_TEST) --config editors/vscode/.vscode-test.mjs

test-integration: test-vscode ## Deprecated alias for test-vscode — remove after one release

test-stdio: bundle ## End-to-end LSP handshake over stdio (Phase 0 smoke)
	$(NODE) scripts/smoke-stdio.mjs

test-helix: .ci-tools/node-$(NODE_VERSION) ## Static validation of editors/helix/ artefacts (Node only, hermetic)
	$(NODE) --test editors/helix/test/*.test.mjs

test-helix-integration: .ci-tools/helix-$(HELIX_VERSION) .ci-tools/tree-sitter-$(TS_VERSION) ## Parse YAML fixtures via tree-sitter, exercise `hx --health otelcol`
	HELIX_TS_TESTS=1 $(NODE) --test editors/helix/test/*.test.mjs
	$(eval _HX_TMP := $(shell mktemp -d))
	@mkdir -p $(_HX_TMP)/helix && cp editors/helix/languages.toml $(_HX_TMP)/helix/
	XDG_CONFIG_HOME=$(_HX_TMP) HELIX_RUNTIME=$(CURDIR)/editors/helix/runtime $(HX) --health otelcol; \
	  status=$$?; rm -rf $(_HX_TMP); exit $$status

test-jetbrains: bundle .ci-tools/java-$(JAVA_VERSION) .ci-tools/gradle-$(GRADLE_VERSION) ## JetBrains plugin unit tests (gradle test)
	cd editors/jetbrains && $(GRADLEW) test

verify-jetbrains: bundle .ci-tools/java-$(JAVA_VERSION) .ci-tools/gradle-$(GRADLE_VERSION) ## Run JetBrains Plugin Verifier across the declared IDE range (catches missing <depends>, classloader issues)
	cd editors/jetbrains && $(GRADLEW) verifyPlugin

test-zed: .ci-tools/rust-wasm32-$(RUST_VERSION) ## Zed extension cargo tests (static TOML + query validation)
	cd editors/zed && $(CARGO) test

test-editors: test-helix test-vscode test-jetbrains test-zed test-stdio ## Run all per-editor suites + stdio smoke

build-jetbrains: bundle .ci-tools/java-$(JAVA_VERSION) .ci-tools/gradle-$(GRADLE_VERSION) ## Assemble JetBrains plugin distributable
	cd editors/jetbrains && $(GRADLEW) assemble

build-zed: .ci-tools/rust-wasm32-$(RUST_VERSION) ## Compile Zed extension to wasm32-wasip1
	cd editors/zed && $(CARGO) build --target wasm32-wasip1

build-editors: build-jetbrains build-zed ## Build all editor artefacts (Helix is config-only, nothing to build)

lint: .ci-tools/node-$(NODE_VERSION) ## Run oxlint
	$(OXLINT)

lint-fix: .ci-tools/node-$(NODE_VERSION) ## Run oxlint with --fix
	$(OXLINT) --fix

format: .ci-tools/node-$(NODE_VERSION) ## Auto-format files in place (oxfmt --write)
	$(OXFMT) --write .

format-check: .ci-tools/node-$(NODE_VERSION) ## Verify formatting (oxfmt --check); non-zero on diff
	$(OXFMT) --check .

typecheck: .ci-tools/node-$(NODE_VERSION) ## TypeScript type check (tsc --noEmit) for server + VS Code extension
	$(TSC) --noEmit -p .
	$(TSC) --noEmit -p editors/vscode

audit: .ci-tools/osv-scanner-$(OSV_SCANNER_VERSION) ## Vulnerability scan via osv-scanner (OSV database, recursive)
	$(OSV_SCANNER) scan --recursive --no-ignore \
	  --experimental-exclude node_modules \
	  --experimental-exclude .ci-tools \
	  --experimental-exclude .vscode-test \
	  --experimental-exclude editors/zed/target \
	  --experimental-exclude editors/zed/grammars \
	  .

package-check: bundle ## Dry-run VSIX packaging (vsce ls); catches missing files
	$(VSCE) ls

check: lint format-check typecheck audit test package-check ## Run all quality gates (CI entry-point)

# --- packaging ----------------------------------------------------------------
# Each per-editor target produces one distributable in dist/packages/. `package`
# is the umbrella. `publish` still maps to VS Code only — JetBrains/Zed publish
# flows aren't wired up yet.
DIST_PKG := dist/packages
# Parse without invoking node — Make evaluates $(shell ...) at parse time, before
# bootstrap may have installed the pinned node. Matches the first `"version": "…"`
# pair in package.json.
VERSION  := $(shell awk -F'"' '/^[[:space:]]*"version"[[:space:]]*:/{print $$4; exit}' package.json)

$(DIST_PKG):
	@mkdir -p $(DIST_PKG)

package: package-vscode package-jetbrains package-zed package-helix ## Build every editor's distributable into dist/packages/

package-vscode: bundle | $(DIST_PKG) ## VS Code .vsix → dist/packages/
	# vsce reads README.md from the package root. Swap in the
	# Marketplace-specific README.vscode.md for the duration of the
	# packaging, then restore. `trap` guarantees restore on Ctrl-C / fail.
	@set -e; \
	  cp README.md .README.md.vsce-bak; \
	  trap 'mv .README.md.vsce-bak README.md' EXIT INT TERM; \
	  cp docs/dist/vscode-readme.md README.md; \
	  $(VSCE) package --out $(DIST_PKG)/

package-jetbrains: bundle .ci-tools/java-$(JAVA_VERSION) .ci-tools/gradle-$(GRADLE_VERSION) | $(DIST_PKG) ## JetBrains plugin .zip → dist/packages/
	# buildSearchableOptions launches a headless IDE to build a search index;
	# the plugin is small enough that the index is not worth the headless-IDE
	# flakiness. Skip it.
	cd editors/jetbrains && $(GRADLEW) buildPlugin -x buildSearchableOptions
	cp editors/jetbrains/build/distributions/*.zip $(DIST_PKG)/

package-zed: .ci-tools/rust-wasm32-$(RUST_VERSION) | $(DIST_PKG) ## Zed extension tarball (release WASM + extension.toml + languages/)
	cd editors/zed && $(CARGO) build --release --target wasm32-wasip1
	tar czf $(DIST_PKG)/otelcol-zed-$(VERSION).tar.gz \
	    -C editors/zed extension.toml languages \
	    -C target/wasm32-wasip1/release otelcol_zed.wasm

package-helix: | $(DIST_PKG) ## Helix config + queries tarball (users extract into ~/.config/helix/)
	tar czf $(DIST_PKG)/otelcol-helix-$(VERSION).tar.gz \
	    -C editors/helix languages.toml runtime

# --- publish ------------------------------------------------------------------
# The root package.json drives two registries from one version:
#   - VS Code Marketplace (`vsce publish`) — ships the bundled extension
#   - npm (`npm publish`)                  — ships the standalone
#       otelcol-language-server binary used by Zed / Helix / JetBrains
# The two channels MUST stay in lockstep, otherwise non-VS Code editors get
# a stale LSP. `make publish` is the aggregate; the bump targets bump the
# version exactly once and then fan out to both raw publish targets.
# JetBrains / Zed / Helix registry uploads aren't automated yet; the targets
# print the manual steps so the Make surface is uniform across editors.

publish: publish-vscode publish-npm ## Publish to both VS Code Marketplace and npm (automated channels). Prints reminder for jetbrains/zed/helix.
	@echo
	@echo "==> Reminder: JetBrains, Zed and Helix have manual steps:"
	@echo "      make publish-jetbrains   # upload .zip to JetBrains Marketplace"
	@echo "      make publish-zed         # open PR against zed-industries/extensions"
	@echo "      make publish-helix       # tarball is for end-users to extract"

publish-vscode: check ## Publish current version to the VS Code Marketplace (requires VSCE_PAT or `vsce login otelery`)
	# Same README swap as package-vscode — vsce publish re-packages internally.
	@set -e; \
	  cp README.md .README.md.vsce-bak; \
	  trap 'mv .README.md.vsce-bak README.md' EXIT INT TERM; \
	  cp docs/dist/vscode-readme.md README.md; \
	  $(VSCE) publish

publish-npm: check ## Publish the otelcol-language-server binary to npm (requires NPM_TOKEN or `npm login`)
	# npm always reads README.md from the package root. Swap in the LSP-
	# specific README.npm.md for the duration of the publish, then restore.
	# `trap` guarantees restore even on Ctrl-C or publish failure.
	@set -e; \
	  cp README.md .README.md.publish-bak; \
	  trap 'mv .README.md.publish-bak README.md' EXIT INT TERM; \
	  cp docs/dist/npm-readme.md README.md; \
	  $(NPM) publish

publish-jetbrains: package-jetbrains ## Print manual upload steps for the JetBrains Marketplace
	@echo "Upload $(DIST_PKG)/*.zip to https://plugins.jetbrains.com/plugin/edit"

publish-zed: package-zed ## Print steps for submitting the Zed extension to zed-industries/extensions
	@echo "Open a PR against https://github.com/zed-industries/extensions"
	@echo "  - add/update the otelcol entry with version $(VERSION)"
	@echo "  - users install via Zed's extension picker; tarball $(DIST_PKG)/otelcol-zed-$(VERSION).tar.gz is for reference"

publish-helix: package-helix ## Print install instructions for end-users
	@echo "Helix has no central registry; ship $(DIST_PKG)/otelcol-helix-$(VERSION).tar.gz"
	@echo "End-users extract it into ~/.config/helix/ and install the LSP via 'npm i -g opentelemetry-collector-config'"

publish-patch: check ## Bump patch version (x.y.Z) and publish to vsce + npm
	$(NPM) version patch --no-git-tag-version
	$(MAKE) publish-vscode publish-npm

publish-minor: check ## Bump minor version (x.Y.0) and publish to vsce + npm
	$(NPM) version minor --no-git-tag-version
	$(MAKE) publish-vscode publish-npm

publish-major: check ## Bump major version (X.0.0) and publish to vsce + npm
	$(NPM) version major --no-git-tag-version
	$(MAKE) publish-vscode publish-npm

check-versions: ## Show pinned vs latest versions for all .mise.toml tools (mise outdated --bump)
	$(MISE) outdated --bump

# Per-cargo-plugin sentinel. cargo-outdated isn't a runtime build dep so it
# lives outside .mise.toml; CARGO_INSTALL_ROOT keeps the binary inside the
# .ci-tools/ sandbox (distclean wipes it) instead of polluting ~/.cargo/bin.
# Compile-from-source is a one-time hit (~2 min) cached behind the sentinel.
# PKG_CONFIG_PATH is cleared so libgit2-sys vendors libgit2 instead of linking
# whatever happens to be on the dev box (e.g. linuxbrew's libgit2 1.9, which
# isn't on the runtime loader path).
CARGO_PLUGINS_BIN := $(CURDIR)/.ci-tools/cargo-bin
CARGO_OUTDATED   := $(CARGO_PLUGINS_BIN)/bin/cargo-outdated

.ci-tools/cargo-outdated.stamp: .ci-tools/rust-$(RUST_VERSION)
	CARGO_INSTALL_ROOT=$(CARGO_PLUGINS_BIN) PKG_CONFIG_PATH= \
	  $(CARGO) install --locked cargo-outdated
	@touch $@

outdated: check-versions $(NPM_INSTALL_STAMP) .ci-tools/cargo-outdated.stamp .ci-tools/java-$(JAVA_VERSION) .ci-tools/gradle-$(GRADLE_VERSION) ## List outdated deps across npm, Cargo, and Gradle (mise toolchain via check-versions)
	@printf "\n\033[36m== npm (package.json) ==\033[0m\n"
	-@$(NPM) outdated
	@printf "\n\033[36m== cargo (editors/zed) ==\033[0m\n"
	-@$(CARGO_OUTDATED) outdated --root-deps-only --manifest-path editors/zed/Cargo.toml
	@printf "\n\033[36m== gradle (editors/jetbrains) ==\033[0m\n"
	-@cd editors/jetbrains && $(GRADLEW) -q dependencyUpdates --refresh-dependencies

upgrade-tools: ## Upgrade all tools in .mise.toml to latest and write versions back (mise up --bump)
	$(MISE) up --bump
	@echo "Done. Run \`make bootstrap\` to install updated tools."

clean: ## Remove build artefacts (dist/, out/, .vscode-test cache, editor build dirs). Keeps .ci-tools/ — wipe with `make distclean`.
	rm -rf dist out .vscode-test
	rm -rf editors/jetbrains/build editors/zed/target
	rm -f *.vsix

distclean: clean ## Full reset: clean + remove node_modules and .ci-tools/ (forces full bootstrap on next build)
	rm -rf node_modules .ci-tools
