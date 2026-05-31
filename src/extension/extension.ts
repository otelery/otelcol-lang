import * as path from "node:path";
import {
  commands,
  ExtensionContext,
  languages,
  Location,
  Position,
  Range,
  Selection,
  TextDocument,
  TextEditorRevealType,
  Uri,
  window,
  workspace,
} from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { looksLikeOtelcol } from "./sniffer";

let client: LanguageClient | undefined;

async function maybeRetagYaml(doc: TextDocument): Promise<void> {
  if (doc.languageId !== "yaml") return;
  if (doc.uri.scheme !== "file") return;
  const fsPath = doc.uri.fsPath;
  if (!looksLikeOtelcol(doc.getText(), fsPath)) return;
  await languages.setTextDocumentLanguage(doc, "otelcol");
}

interface LspPosition {
  line: number;
  character: number;
}
interface LspLocation {
  uri: string;
  range: { start: LspPosition; end: LspPosition };
}

// Convert LSP-style plain-JSON arguments coming from the server (via CodeLens
// commands) into real vscode.* instances, then dispatch:
//   - 0 locations → info message (don't open an empty peek widget)
//   - 1 location  → navigate directly (skip the single-row peek that requires
//                   an extra click)
//   - 2+          → standard references peek widget
// Required because VS Code's built-in commands validate argument types
// strictly and reject the raw JSON shapes the LSP wire delivers.
async function showReferencesCmd(
  uri: string,
  position: LspPosition,
  locations: LspLocation[],
): Promise<void> {
  const vUri = Uri.parse(uri);
  const vPos = new Position(position.line, position.character);
  const vLocs = locations.map(
    (l) =>
      new Location(
        Uri.parse(l.uri),
        new Range(
          new Position(l.range.start.line, l.range.start.character),
          new Position(l.range.end.line, l.range.end.character),
        ),
      ),
  );
  if (vLocs.length === 0) {
    void window.showInformationMessage("No references found.");
    return;
  }
  if (vLocs.length === 1) {
    const loc = vLocs[0];
    const doc = await workspace.openTextDocument(loc.uri);
    const editor = await window.showTextDocument(doc, { preview: true });
    editor.selection = new Selection(loc.range.start, loc.range.start);
    editor.revealRange(loc.range, TextEditorRevealType.InCenterIfOutsideViewport);
    return;
  }
  await commands.executeCommand("editor.action.showReferences", vUri, vPos, vLocs);
}

export function activate(context: ExtensionContext) {
  context.subscriptions.push(commands.registerCommand("otelcol.showReferences", showReferencesCmd));
  for (const doc of workspace.textDocuments) void maybeRetagYaml(doc);
  context.subscriptions.push(workspace.onDidOpenTextDocument(maybeRetagYaml));

  // `dist/` is populated by esbuild (`npm run compile`, F5's preLaunchTask, and
  // VSIX packaging). `out/` is the tsc output used by tests only. Keeping these
  // in sync was a constant source of "I rebuilt, why doesn't it pick up?".
  const serverModule = context.asAbsolutePath(path.join("dist", "server", "server.js"));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6099"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    // Content-based only: any document carrying language id `otelcol`. The
    // `maybeRetagYaml` sniffer is the single source of truth for what counts
    // as a collector config; filename patterns are intentionally not used.
    documentSelector: [{ language: "otelcol" }],
    synchronize: {
      configurationSection: "otelcol",
      fileEvents: workspace.createFileSystemWatcher("**/*.{yaml,yml}"),
    },
  };

  client = new LanguageClient("otelcol", "OpenTelemetry Collector", serverOptions, clientOptions);
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
