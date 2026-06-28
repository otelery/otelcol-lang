use zed_extension_api::{
    self as zed,
    serde_json,
    settings::LspSettings,
    LanguageServerId, LanguageServerInstallationStatus, Result, Worktree,
};

const LSP_NAME: &str = "otelcol-language-server";
const SERVER_ID: &str = "otelcol";

// The language server ships as a Node package on npm. Its `bin` entry
// (`otelcol-language-server`) differs from the package name, so Zed can't
// install it by the binary name — we install the package explicitly and then
// spawn its bin shim with Zed's bundled Node.
const NPM_PACKAGE: &str = "opentelemetry-collector-config";

// Path to the server's bin shim inside the installed package, relative to the
// extension's working directory (where Zed runs `npm install`). The shim is a
// `#!/usr/bin/env node` script that boots the stdio language server.
const SERVER_ENTRY: &str = "node_modules/opentelemetry-collector-config/bin/otelcol-language-server.js";

// Install the npm package version that matches this extension (the repo keeps
// the extension and the npm package in lockstep), so a given extension release
// always pairs with the server it was built against.
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

struct OtelcolExtension;

impl OtelcolExtension {
    fn default_args() -> Vec<String> {
        vec!["--stdio".into()]
    }

    // Ensure the language server package is installed in the extension work dir
    // and return the path to its bin shim. Reused across restarts; npm is a
    // no-op when the wanted version is already present.
    fn ensure_server_installed(&mut self, language_server_id: &LanguageServerId) -> Result<String> {
        zed::set_language_server_installation_status(
            language_server_id,
            &LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let installed = zed::npm_package_installed_version(NPM_PACKAGE)?;
        if installed.as_deref() != Some(SERVER_VERSION) {
            zed::set_language_server_installation_status(
                language_server_id,
                &LanguageServerInstallationStatus::Downloading,
            );

            // Prefer the lockstep version; if it isn't published yet (e.g. a
            // brand-new release), fall back to npm's latest.
            let result = zed::npm_install_package(NPM_PACKAGE, SERVER_VERSION).or_else(|_| {
                zed::npm_package_latest_version(NPM_PACKAGE)
                    .and_then(|latest| zed::npm_install_package(NPM_PACKAGE, &latest))
            });

            if let Err(err) = result {
                // If a previous session already installed a copy, keep using it
                // rather than failing hard on a transient network error.
                if zed::npm_package_installed_version(NPM_PACKAGE)?.is_none() {
                    zed::set_language_server_installation_status(
                        language_server_id,
                        &LanguageServerInstallationStatus::Failed(err.clone()),
                    );
                    return Err(err);
                }
            }
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &LanguageServerInstallationStatus::None,
        );
        Ok(SERVER_ENTRY.to_string())
    }
}

impl zed::Extension for OtelcolExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<zed::Command> {
        let binary_settings = LspSettings::for_worktree(SERVER_ID, worktree)
            .ok()
            .and_then(|s| s.binary);

        let env = binary_settings
            .as_ref()
            .and_then(|s| s.env.as_ref())
            .map(|env| env.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();

        // 1. Explicit override from settings (`lsp.otelcol.binary.path`) — the
        //    escape hatch for local server development.
        if let Some(command) = binary_settings.as_ref().and_then(|s| s.path.clone()) {
            let args = binary_settings
                .as_ref()
                .and_then(|s| s.arguments.clone())
                .filter(|a| !a.is_empty())
                .unwrap_or_else(Self::default_args);

            return Ok(zed::Command { command, args, env });
        }

        // 2. A server already on PATH (e.g. a global `npm i -g`) wins over an
        //    extension-managed copy, so power users stay in control.
        if let Some(path) = worktree.which(LSP_NAME) {
            return Ok(zed::Command {
                command: path,
                args: Self::default_args(),
                env,
            });
        }

        // 3. Zero-config default: install the npm package into the extension
        //    work dir and run its bin shim with Zed's bundled Node.
        let server_entry = self.ensure_server_installed(language_server_id)?;
        let mut args = vec![server_entry];
        args.extend(Self::default_args());
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args,
            env,
        })
    }

    fn language_server_workspace_configuration(
        &mut self,
        _server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Option<serde_json::Value>> {
        Ok(LspSettings::for_worktree(SERVER_ID, worktree)
            .ok()
            .and_then(|s| s.settings))
    }
}

zed::register_extension!(OtelcolExtension);
