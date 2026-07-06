import { defineConfig } from "@vscode/test-cli";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// editors/vscode/ is the self-contained extension root: it contains package.json,
// dist/, syntaxes/, language-configuration.json, icon.png, README.md, LICENSE,
// and CHANGELOG.md. No file swaps needed - the Extension Host reads this directory.
const extensionRoot = dirname(fileURLToPath(import.meta.url));

const mocha = { ui: "bdd", timeout: 20000 };
const shared = { extensionDevelopmentPath: extensionRoot };

export default defineConfig([
  {
    ...shared,
    label: "simple-workspace",
    files: "../../out/test/integration/*.test.js",
    workspaceFolder: "../../test/simple",
    mocha,
  },
  {
    ...shared,
    label: "complex-workspace",
    files: "../../out/test/integration/crossfile/**/*.test.js",
    workspaceFolder: "../../test/complex",
    mocha,
  },
]);
