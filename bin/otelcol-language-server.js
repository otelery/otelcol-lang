#!/usr/bin/env node
// Standalone entry for the OpenTelemetry Collector language server.
// vscode-languageserver/node picks the transport from process.argv
// (--stdio, --node-ipc, --socket=PORT). Editors should invoke this as
//   otelcol-language-server --stdio
require("../dist/server/server.js");
