import { defineConfig } from "@vscode/test-cli";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// package.json lives at the repo root (single manifest for both the
// VS Code extension and the npm bin). Point @vscode/test-cli there
// so it can read the extension manifest for dependency wiring.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const mocha = { ui: "bdd", timeout: 20000 };
const shared = { extensionDevelopmentPath: repoRoot };

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
