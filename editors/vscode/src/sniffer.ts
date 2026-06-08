// Esbuild bundles this file into dist/extension/extension.js when packaging
// the VSCode VSIX. The actual sniffer rules live in `src/common/yaml-sniff.ts`
// so the LSP server (Zed/Helix fallback) and this client share one
// implementation.
export { looksLikeOtelcol, type SnifferLogger } from "../../../src/common/yaml-sniff";
