# IntelliJ Plugins Using Node.js-Launched LSP Servers

Reference report on how JetBrains IntelliJ community plugins integrate LSP language servers that run as Node.js processes. Source repo: `/home/dol/project/lab/observability/intellij-plugins` (branch `master`).

## Plugins identified

Three plugins launch their LSP server via Node.js:

- **Vue.js** — bundles `vue-language-server`
- **Astro** — bundles `@astrojs/language-server`
- **Prisma** — uses `@prisma/language-server`

(Deno also uses LSP but ships a native Rust binary — not Node-based.)

## Shared platform API

All three rely on the same platform classes from `com.intellij.lang.typescript.lsp.*` (provided by the JS/TS plugin, not in this repo):

- `JSNodeLspClientDescriptor` — base class that knows how to spawn Node and pipe LSP traffic over stdio. Resolves the project's Node interpreter via `NodeJsInterpreterManager` / `NodeCommandLineConfigurator` and runs `node <entry-point.js> --stdio`.
- `LspServerPackageDescriptor` — declares npm package name, default version, and the relative entry-point `.js` file.
- `LspServerLoader` — resolves the package (bundled-with-plugin vs. project `node_modules`) and hands the resolved JS path to the descriptor.

The IntelliJ LSP API (`com.intellij.platform.lsp.api`) starts the process and speaks LSP via `lsp4j`.

## Launch flow

1. File opens → `LspServerSupportProvider` matches → loader resolves the JS entry point (bundled or from `node_modules`).
2. `JSNodeLspClientDescriptor` builds the command line: project Node interpreter + entry-point + `--stdio`.
3. Platform LSP infra manages the process lifecycle and routes LSP messages via lsp4j.

None of these plugins spawn Node themselves — all delegate to the shared triad above.

## File paths

### Vue.js (`vuejs/vuejs-backend`)

- `/home/dol/project/lab/observability/intellij-plugins/vuejs/vuejs-backend/src/org/jetbrains/vuejs/lang/typescript/service/lsp/VueLspClientHybridModeProvider.kt`
- `/home/dol/project/lab/observability/intellij-plugins/vuejs/vuejs-backend/src/org/jetbrains/vuejs/lang/typescript/service/lsp/VueLspClientHybridModeDescriptor.kt`
- `/home/dol/project/lab/observability/intellij-plugins/vuejs/vuejs-backend/src/org/jetbrains/vuejs/lang/typescript/service/lsp/VueLspClientTakeoverModeProvider.kt`
- `/home/dol/project/lab/observability/intellij-plugins/vuejs/vuejs-backend/src/org/jetbrains/vuejs/lang/typescript/service/lsp/VueLspServerTakeoverModeLoader.kt`
- `/home/dol/project/lab/observability/intellij-plugins/vuejs/vuejs-backend/src/org/jetbrains/vuejs/lang/typescript/service/lsp/VueLspServerHybridModeLoaderFactory.kt`
- `/home/dol/project/lab/observability/intellij-plugins/vuejs/vuejs-backend/src/org/jetbrains/vuejs/lang/typescript/service/lsp/VueLspServerPackageDescriptor.kt`
- `/home/dol/project/lab/observability/intellij-plugins/vuejs/vuejs-backend/src/org/jetbrains/vuejs/lang/typescript/service/lsp/VueHybridModeLsp4jClient.kt`

Package descriptor highlights (`VueLspServerPackageDescriptor.kt`):

- npm package: `vue-language-server`
- entry point: `/bin/vue-language-server.js`
- bundled at: `vue-language-tools/language-server/<version>`
- registry toggles: `vue.language.server.bundled.enabled`, `vue.language.server.default.version`

### Astro (`Astro`)

- `/home/dol/project/lab/observability/intellij-plugins/Astro/src/org/jetbrains/astro/service/AstroLspClientProvider.kt`
- `/home/dol/project/lab/observability/intellij-plugins/Astro/src/org/jetbrains/astro/service/AstroLspTypeScriptService.kt`
- `/home/dol/project/lab/observability/intellij-plugins/Astro/src/org/jetbrains/astro/service/AstroServices.kt`
- `/home/dol/project/lab/observability/intellij-plugins/Astro/src/org/jetbrains/astro/service/settings/AstroServiceConfigurable.kt`
- `/home/dol/project/lab/observability/intellij-plugins/Astro/src/org/jetbrains/astro/service/settings/AstroServiceSettings.kt`

`AstroServices.kt` contains `AstroLspServerPackageDescriptor` (bundled `@astrojs/language-server`) and `AstroLspServerLoader`.

### Prisma (`prisma`)

- `/home/dol/project/lab/observability/intellij-plugins/prisma/src/org/intellij/prisma/ide/lsp/PrismaLspClientDescriptor.kt`
- `/home/dol/project/lab/observability/intellij-plugins/prisma/src/org/intellij/prisma/ide/lsp/PrismaLspClientProvider.kt`
- `/home/dol/project/lab/observability/intellij-plugins/prisma/src/org/intellij/prisma/ide/lsp/PrismaServiceSettings.kt`

`PrismaLspClientDescriptor` extends `JSNodeLspClientDescriptor`. `PrismaLspClientProvider.kt` declares `PrismaLspServerPackageDescriptor("@prisma/language-server", …)` and `PrismaLspServerLoader`.

### Deno (for contrast — not Node-based)

- `/home/dol/project/lab/observability/intellij-plugins/Deno/src/com/intellij/deno/service/DenoLspClientDescriptor.kt`

Ships a native Deno binary; included only to show what the non-Node path looks like.

## Key takeaways for an LSP-over-Node implementation

- Subclass `JSNodeLspClientDescriptor` for the client; override only `lspCustomization` and config getters (see `PrismaLspClientDescriptor.kt:44-80`).
- Declare the server package with `LspServerPackageDescriptor(name, defaultVersion, defaultPackageRelativePath)` — the relative path points at the JS entry inside the npm package.
- Use `PackageVersion.bundled(...)` when shipping the server inside the plugin jar; expose registry keys for toggling bundled vs. `node_modules`.
- Provide an `LspServerLoader` to choose between bundled and project-local resolution.
- The LSP transport is stdio with `--stdio`; lsp4j handles framing.

---

## Development cycle of the LSP servers

### Where the server JS lives

The plugins do **not** rely on a central/global `node_modules`. Each plugin ships the server JS _inside the plugin distribution_ and resolves it via a project-scoped `NodePackage`. The end user's machine does not need npm/yarn installed — only a Node interpreter for execution. (Users may _opt in_ to a project-local `node_modules` copy via the plugin's settings UI; this just changes which absolute path `LspServerLoader.getSelectedPackage(project)` returns.)

Bundled layouts inside this repo:

- Vue: `/home/dol/project/lab/observability/intellij-plugins/vuejs/vuejs-backend/vue-language-tools/language-server/<version>/bin/vue-language-server.js`
  - Versions checked in: `2.2.10/`, `3.0.10/`, `3.3.4/` — each contains a single rolldown-built `bin/vue-language-server.js` (`rolldown.config.ts`, `package.json` pinning `@vue/language-server`).
- Astro: `/home/dol/project/lab/observability/intellij-plugins/Astro/astro-language-server/` — `.gitignore` excludes `node_modules` and `*.js.map`; README references `WEB-68605 Bundle Vue, Svelte, Astro language servers`.
- Prisma: `/home/dol/project/lab/observability/intellij-plugins/prisma/language-server/` (source/build) and `/home/dol/project/lab/observability/intellij-plugins/prisma/gen-resources/language-server/` (built artefacts — `prisma-language-server.js`, `prisma-fmt.js`, `prisma_schema_build_bg.wasm`). Built via webpack: `prisma:lsp` script → `webpack --config webpack.config.js`.

So the layout is: `<plugin>/<localPath>/<version>/<package>/<entry>.js`. The `pluginPath` + `localPath` arguments to `PackageVersion.bundled(...)` tell the platform where to look at runtime inside the installed plugin jar/dir.

### How the path is resolved at runtime

1. `LspServerLoader.getSelectedPackage(project)` returns a `NodePackage` (settings-driven: either the bundled copy or a user-pointed `node_modules` path).
2. `LspServerPackageDescriptor.defaultPackageRelativePath` (e.g. `/bin/vue-language-server.js`, `/bin/nodeServer.js`) is appended.
3. `JSNodeLspClientDescriptor` constructs the Node command line and starts the process via the platform's LSP infra.

The `isBundledEnabled = { Registry.is("…bundled.enabled") }` toggles whether the bundled copy is allowed. Default version is registry-overridable too (`Registry.stringValue("…default.version")`).

### Caching / why the server "doesn't update" during development

There are three caches in play that bite when iterating on the `.js`:

1. **LSP process is long-lived.** The Node process stays running until the project closes or the server is restarted. Editing `bin/<server>.js` on disk has no effect until you restart the LSP server.
   - The plugins expose programmatic restart: `restartTypeScriptServicesAsync(project)` (Astro/Vue) and `restartPrismaServerAsync(project)` (Prisma). Settings panels call these on changes — that's why merely toggling the settings dialog can pick up changes.
   - You can also use the IDE action "Restart TypeScript Service" or close/reopen the project.
2. **Plugin-resource cache (the tricky one).** Because the JS sits in plugin resources, when you run the IDE from Gradle/IntelliJ dev sandbox, the path the platform resolves often points at the _staged_ sandbox copy (e.g. `…/build/idea-sandbox/plugins/<plugin>/<localPath>/<version>/…`), not your source tree. Editing the source `.js` does nothing until the Gradle task that copies/links resources runs again.
   - Fixes:
     - Re-run the `prepareSandbox` / `processResources` Gradle task (or the Run/Debug configuration that depends on it) after each `.js` change.
     - For Prisma/Vue/Astro specifically: rebuild the bundle (`npm run build` in `prisma/language-server`, `npm run build` / `rolldown --config` in `vuejs/.../language-server/<v>/`, equivalent in `Astro/astro-language-server/`) — editing the _generated_ `.js` directly works, but the next build will clobber it.
     - In settings, point `lspServerPackage` at an absolute path under your working tree (a real `node_modules` checkout). Then you skip the sandbox copy entirely.
3. **Registry-driven version pinning.** `defaultVersion` (the literal string in `VueLspServerPackageDescriptor("2.2.10")`, `AstroLspServerPackageDescriptor("2.16.6")`, etc.) chooses _which subdirectory_ under `localPath` is loaded. If you drop a new server bundle into a new version dir but don't bump the descriptor (or override `vue.language.server.default.version` in the Registry), the platform happily keeps loading the old one.

### Recommended dev loop

For _your own_ Node-based LSP server bundled the same way:

1. Keep one canonical source tree for the server outside the plugin (`<plugin>/language-server/`), with a `build` script that emits a single `.js` (Astro/Vue use rolldown; Prisma uses webpack).
2. The build's output dir == the `localPath` from `PackageVersion.bundled(...)`. Make `processResources` depend on the JS build so a Gradle build picks up server changes automatically.
3. During tight iteration:
   - Edit JS → rebuild bundle → trigger `prepareSandbox` → invoke the LSP restart action (`restartTypeScriptServicesAsync` or your equivalent). Avoid full IDE restarts.
   - Or point the settings at a real `node_modules` path so you skip the sandbox copy entirely; then `npm link` your dev server into that path.
4. Expose registry keys for version + bundled-enabled toggle (every plugin here does) so you can A/B against user-installed versions without rebuilding.
5. Wire your settings panel's `setter` to call your restart helper — both Astro (`AstroServiceSettings.kt:68`) and Prisma (`PrismaServiceSettings.kt:24,33`) do this, and it's what makes the dev cycle bearable.

### Answer to the central-`node_modules` question

**No.** None of these plugins assume a centrally installed `node_modules`. They:

- Ship a pre-built single-file server inside the plugin (bundled mode, default).
- _Optionally_ let the user point the settings at any local `node_modules` directory containing the npm package (custom mode).

The "central place" people sometimes see is the _plugin's own resource directory inside the IDE installation/sandbox_ — that's where the bundled copy is unpacked. The cache pain is almost always the gap between your editable source `.js` and the sandbox-staged `.js` that the platform actually loads.

---

## SonarLint for IntelliJ — a contrasting case

Repo: `/home/dol/project/lab/observability/sonarlint-intellij`

SonarLint is **not** comparable to Vue/Astro/Prisma in architecture, but it's instructive because it shows the alternative when you outgrow the IntelliJ LSP API and want process-level control. The implications for caching and dev-cycle differ accordingly.

### Architecture

- **Does not use `com.intellij.platform.lsp.api`.** Instead it embeds `sonarlint-core` and talks to a long-running out-of-process backend ("sloop") via SonarSource's custom JSON-RPC protocol (`org.sonarsource.sonarlint.core.rpc.client.SloopLauncher`).
- **The backend is a Java process, not Node.** It is launched with the user's `java.home` (or `sonarlint.jre.path` system property override), pointing at the sloop distribution that was unpacked into the plugin folder.
- **Node.js is only an analyzer dependency.** Sloop runs JS/TS/CSS analyzers internally; for that it needs a Node interpreter at runtime. SonarLint discovers one via `JavaScriptNodeJsProvider`, which queries the project's `NodeJsInterpreterManager` and passes the resolved absolute path down to the backend. It deliberately rejects WSL/remote/downloadable interpreters and only forwards local ones.

### Key files (absolute paths)

- Backend launcher / lifecycle:
  - `/home/dol/project/lab/observability/sonarlint-intellij/src/main/java/org/sonarlint/intellij/core/BackendService.kt`
    - `startSloopProcess()` around line 307: builds `SloopLauncher`, resolves `<plugin>/sloop`, applies executable bits, calls `sloopLauncher.start(sloopPath, jreHomePath, …)`.
    - `listenForProcessExit` (line 324), restart logic (~line 911), `isAlive` (~1117).
- Restart action: `/home/dol/project/lab/observability/sonarlint-intellij/src/main/java/org/sonarlint/intellij/actions/RestartBackendAction.kt`
- Node discovery (extension point):
  - SPI: `/home/dol/project/lab/observability/sonarlint-intellij/common/src/main/java/org/sonarlint/intellij/common/nodejs/NodeJsProvider.kt`
  - JS-plugin-backed impl: `/home/dol/project/lab/observability/sonarlint-intellij/nodejs/src/main/java/org/sonarlint/intellij/nodejs/JavaScriptNodeJsProvider.kt`
- User-facing Node settings: `/home/dol/project/lab/observability/sonarlint-intellij/src/main/java/org/sonarlint/intellij/config/global/NodeJsSettings.kt`
- Gradle wiring that downloads + unpacks the backend: `/home/dol/project/lab/observability/sonarlint-intellij/build.gradle.kts`
  - Custom configuration `register("sloop")` (line ~69).
  - `"sloop"("org.sonarsource.sonarlint.core:sonarlint-backend-cli:${libs.versions.sonarlint.core.get()}:no-arch@zip")` (~line 115).
  - Copies the unpacked artefact into `<destinationDir>/<pluginName>/sloop/` (~line 272–275).

### Caching and dev-cycle implications (vs. the LSP plugins above)

| Concern                    | Vue / Astro / Prisma                                              | SonarLint                                                                                                           |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| What runs                  | `node <bundled>.js --stdio`                                       | `java -jar <sloop>/lib/*.jar` (managed by `SloopLauncher`)                                                          |
| Where the artefact lives   | `<plugin>/<localPath>/<version>/bin/<server>.js`                  | `<plugin>/sloop/` (unpacked zip)                                                                                    |
| How it's updated in dev    | Rebuild JS → `processResources`/`prepareSandbox` → restart LSP    | Bump `libs.versions.sonarlint.core` → Gradle re-resolves `sloop` configuration → `prepareSandbox` → restart backend |
| Process restart            | `restartTypeScriptServicesAsync` / `restartPrismaServerAsync`     | `RestartBackendAction`                                                                                              |
| `node_modules` involvement | Optional — settings can point at one                              | None — Node is only an _analyzer runtime_ for the backend                                                           |
| Caches that bite           | Sandbox-staged `.js`, registry-pinned version, long-lived process | Sandbox-staged sloop zip, the JBR / `java.home` you launched with, long-lived backend process                       |

### Notable consequences for your problem

- **No bundled-`node_modules` strategy.** SonarLint does not ship any npm package and does not care where `node_modules` lives. The only Node-side decision it makes is _which `node` binary to call_; that path comes from the project's IntelliJ Node interpreter, not from a bundled tree.
- **Out-of-process Java backend means the same staleness pattern as Node-LSP plugins.** When you edit code in sloop and want it picked up: rebuild the sloop artefact, re-run `prepareSandbox`, invoke `RestartBackendAction`. The IDE itself need not restart.
- **No registry-version trick.** Version pinning is in `gradle.lockfile` / `libs.versions.toml`, not the IntelliJ Registry. There is no runtime A/B-toggle between bundled and user-provided sloop — it's whatever Gradle put in `<plugin>/sloop/`.
- **Override hatches** exist for both halves of the runtime: `sonarlint.jre.path` system property to swap the JRE; the Node interpreter selector in the project settings to swap Node.

### When this model would help you

If your "LSP server cache" problem stems from JS-bundle resolution gymnastics (multiple package versions, optional user-supplied `node_modules`, registry pin), the SonarLint model sidesteps all of it by:

1. Owning the server process explicitly (`SloopLauncher`-equivalent) instead of going through `JSNodeLspClientDescriptor`.
2. Treating the server distribution as a single Gradle-managed artefact unpacked into one well-known plugin subdirectory.
3. Exposing one obvious "Restart Backend" action.

The cost is that you give up the platform's stock LSP plumbing (lsp4j integration, customizers like `LspFormattingSupport`, automatic restart on settings change) — you wire that yourself.
