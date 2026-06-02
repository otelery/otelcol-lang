.PHONY: help install build bundle test test-unit test-integration lint lint-fix \
        format format-check typecheck audit package-check check clean distclean \
        package publish publish-patch publish-minor publish-major check-versions

# Pinned CLI tool versions (Makefile is the source of truth — package.json does
# not declare these). Run `make check-versions` to see what's outdated.
# Programmatic deps (esbuild, @vscode/test-cli, @types/*) live in package.json.
OXLINT_VERSION          := 1.68.0
OXFMT_VERSION           := 0.53.0
VSCE_VERSION            := 3.9.1
TYPESCRIPT_VERSION      := 6.0.3
VSCODE_TEST_CLI_VERSION := 0.0.12

PINNED_TOOLS := \
  oxlint:$(OXLINT_VERSION) \
  oxfmt:$(OXFMT_VERSION) \
  @vscode/vsce:$(VSCE_VERSION) \
  typescript:$(TYPESCRIPT_VERSION) \
  @vscode/test-cli:$(VSCODE_TEST_CLI_VERSION)

# Tool shorthands.
TSC          := npx --package=typescript@$(TYPESCRIPT_VERSION) tsc
OXLINT       := npx --package=oxlint@$(OXLINT_VERSION) oxlint
OXFMT        := npx --package=oxfmt@$(OXFMT_VERSION) oxfmt
VSCE         := npx --package=@vscode/vsce@$(VSCE_VERSION) vsce
VSCODE_TEST  := npx --package=@vscode/test-cli@$(VSCODE_TEST_CLI_VERSION) vscode-test

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies and refresh lockfile (npm install). CI should call `npm ci` directly.
	npm install

build: ## Compile TS to out/ + copy schemas (for unit tests)
	$(TSC) -p .
	node scripts/copy-schemas.mjs

bundle: ## Bundle extension + server with esbuild to dist/ (for VS Code packaging + integration tests)
	node esbuild.js --production

test: test-unit test-integration ## Run both test dimensions

test-unit: build ## LSP modules in isolation (node --test, fast)
	node scripts/check-runtime-paths.mjs
	node --test test/run-tests.mjs test/unit-yaml-model.test.mjs test/unit-completion.test.mjs test/unit-hover.test.mjs

test-integration: bundle ## Integration tests in real VS Code Extension Host (~30s)
	$(TSC) -p tsconfig.test.json
	$(VSCODE_TEST)

lint: ## Run oxlint
	$(OXLINT)

lint-fix: ## Run oxlint with --fix
	$(OXLINT) --fix

format: ## Auto-format files in place (oxfmt --write)
	$(OXFMT) --write .

format-check: ## Verify formatting (oxfmt --check); non-zero on diff
	$(OXFMT) --check .

typecheck: ## TypeScript type check (tsc --noEmit)
	$(TSC) --noEmit -p .

audit: ## CVE check against runtime deps (npm audit --omit=dev)
	npm audit --omit=dev

package-check: bundle ## Dry-run VSIX packaging (vsce ls); catches missing files
	$(VSCE) ls

check: lint format-check typecheck audit test package-check ## Run all quality gates (CI entry-point)

package: bundle ## Produce a local .vsix file (no upload). Output: vscode-otelcol-<version>.vsix
	$(VSCE) package

publish: check ## Publish current package.json version to the VS Code Marketplace (requires VSCE_PAT or `vsce login otelery`)
	$(VSCE) publish

publish-patch: check ## Bump patch version (x.y.Z) and publish
	$(VSCE) publish patch

publish-minor: check ## Bump minor version (x.Y.0) and publish
	$(VSCE) publish minor

publish-major: check ## Bump major version (X.0.0) and publish
	$(VSCE) publish major

check-versions: ## Show pinned vs latest npm versions (copy/paste to bump)
	@printf "%-25s %-12s %s\n" "TOOL" "PINNED" "LATEST"
	@printf "%-25s %-12s %s\n" "----" "------" "------"
	@for entry in $(PINNED_TOOLS); do \
	  pkg=$${entry%:*}; pinned=$${entry##*:}; \
	  latest=$$(npm view "$$pkg" version 2>/dev/null); \
	  if [ -z "$$latest" ]; then \
	    printf "%-25s %-12s %s\n" "$$pkg" "$$pinned" "(lookup failed)"; \
	  elif [ "$$pinned" = "$$latest" ]; then \
	    printf "%-25s %-12s %s\n" "$$pkg" "$$pinned" "$$latest"; \
	  else \
	    printf "%-25s %-12s %s  <- update\n" "$$pkg" "$$pinned" "$$latest"; \
	  fi; \
	done

clean: ## Remove build artefacts (dist/, out/, .vscode-test cache). Keeps node_modules and committed schemas.
	rm -rf dist out .vscode-test

distclean: clean ## Full reset: clean + remove node_modules (forces re-install on next build)
	rm -rf node_modules
