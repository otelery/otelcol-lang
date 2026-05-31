import { defineConfig } from "@vscode/test-cli";

const mocha = { ui: "bdd", timeout: 20000 };

export default defineConfig([
  {
    label: "simple-workspace",
    files: "out/test/integration/*.test.js",
    workspaceFolder: "./test/simple",
    mocha,
  },
  {
    label: "complex-workspace",
    files: "out/test/integration/crossfile/**/*.test.js",
    workspaceFolder: "./test/complex",
    mocha,
  },
]);
