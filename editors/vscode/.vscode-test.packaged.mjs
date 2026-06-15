// Integration-test config that runs against the *packaged* extension.
//
// Same suites as .vscode-test.mjs, but instead of loading the extension from
// the repo root (where everything in-tree is reachable) we point
// extensionDevelopmentPath at an extracted .vsix. That catches mistakes in
// .vscodeignore — if a runtime file is missing from the VSIX, activation
// breaks here even though the in-tree suite stays green.
//
// `make test-vscode-packaged` builds the VSIX, extracts it, and exports the
// extracted path via OTELCOL_PACKAGED_EXTENSION_DIR before invoking vscode-test
// with this config.

import { defineConfig } from "@vscode/test-cli";

const packagedDir = process.env.OTELCOL_PACKAGED_EXTENSION_DIR;
if (!packagedDir) {
  throw new Error(
    "OTELCOL_PACKAGED_EXTENSION_DIR is not set — run `make test-vscode-packaged` instead of invoking vscode-test directly.",
  );
}

const mocha = { ui: "bdd", timeout: 20000 };
const shared = { extensionDevelopmentPath: packagedDir };

export default defineConfig([
  {
    ...shared,
    label: "simple-workspace-packaged",
    files: "../../out/test/integration/*.test.js",
    workspaceFolder: "../../test/simple",
    mocha,
  },
  {
    ...shared,
    label: "complex-workspace-packaged",
    files: "../../out/test/integration/crossfile/**/*.test.js",
    workspaceFolder: "../../test/complex",
    mocha,
  },
]);
