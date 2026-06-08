// Legacy import path retained so `tsc -p .` keeps producing
// `out/extension/sniffer.js` for the Node test runner in `test/run-tests.mjs`.
// Real implementation lives in `src/common/yaml-sniff.ts` — shared with the
// LSP server and the editors/vscode/ copy.
export { looksLikeOtelcol, type SnifferLogger } from "../common/yaml-sniff";
