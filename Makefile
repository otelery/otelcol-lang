.PHONY: help install build bundle test test-unit test-integration lint lint-fix \
        format format-check typecheck audit package-check check clean distclean \
        package publish

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies and refresh lockfile (npm install). CI should call `npm ci` directly.
	npm install

build: ## Sync schemas + compile TS to out/ (for unit tests)
	npm run build

bundle: ## Bundle extension + server with esbuild to dist/ (for VS Code packaging + integration tests)
	npm run vscode:prepublish

test: test-unit test-integration ## Run both test dimensions

test-unit: ## LSP modules in isolation (node --test, fast)
	npm run test

test-integration: bundle ## Integration tests in real VS Code Extension Host (~30s)
	npx tsc -p tsconfig.test.json
	npx vscode-test

lint: ## Run oxlint
	npx oxlint

lint-fix: ## Run oxlint with --fix
	npx oxlint --fix

format: ## Auto-format files in place (oxfmt --write)
	npx oxfmt --write .

format-check: ## Verify formatting (oxfmt --check); non-zero on diff
	npx oxfmt --check .

typecheck: ## TypeScript type check (tsc --noEmit)
	npm run check-types

audit: ## CVE check against runtime deps (npm audit --omit=dev)
	npm audit --omit=dev

package-check: bundle ## Dry-run VSIX packaging (vsce ls); catches missing files
	npx vsce ls

check: lint format-check typecheck audit test package-check ## Run all quality gates (CI entry-point)

package: bundle ## Produce a local .vsix file (no upload). Output: vscode-otelcol-<version>.vsix
	npx vsce package

publish: check ## Publish current package.json version to the VS Code Marketplace (requires VSCE_PAT or `vsce login otelery`)
	npx vsce publish

clean: ## Remove build artefacts (dist/, out/, .vscode-test cache). Keeps node_modules and committed schemas.
	rm -rf dist out .vscode-test

distclean: clean ## Full reset: clean + remove node_modules (forces re-install on next build)
	rm -rf node_modules
