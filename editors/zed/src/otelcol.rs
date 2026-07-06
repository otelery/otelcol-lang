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
// install it by the binary name, so we install the package explicitly and then
// spawn its bin shim with Zed's bundled Node.
const NPM_PACKAGE: &str = "@otelery/otelcol-lang";

// Path to the server's bin shim inside the installed package, relative to the
// extension's working directory (where Zed runs `npm install`). The shim is a
// `#!/usr/bin/env node` script that boots the stdio language server.
const SERVER_ENTRY: &str = "node_modules/@otelery/otelcol-lang/bin/otelcol-language-server.js";

// Install the npm package version that matches this extension (the repo keeps
// the extension and the npm package in lockstep), so a given extension release
// always pairs with the server it was built against.
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

// A PATH hit that resolves to the package's raw `.js` bin shim must be run
// through Node, since Zed spawns the command directly and does not honour the
// `#!/usr/bin/env node` shebang. Pure so it can be unit-tested on the host
// target without the wasm-only `zed_extension_api`.
fn needs_node_wrapper(path: &str) -> bool {
    path.ends_with(".js")
}

struct OtelcolExtension;

impl OtelcolExtension {
    fn default_args() -> Vec<String> {
        vec!["--stdio".into()]
    }

    // Build the spawn command for a resolved server `binary` plus its `args`.
    // A `.js` target (the package's raw bin shim, whether from a `binary.path`
    // override or a PATH hit) is run through Zed's bundled Node, since Zed
    // spawns the command directly and does not honour the script's
    // `#!/usr/bin/env node` shebang. Everything else is spawned as-is.
    fn build_command(
        binary: String,
        args: Vec<String>,
        env: Vec<(String, String)>,
    ) -> Result<zed::Command> {
        if needs_node_wrapper(&binary) {
            let node = zed::node_binary_path()?;
            let mut full = vec![binary];
            full.extend(args);
            Ok(zed::Command {
                command: node,
                args: full,
                env,
            })
        } else {
            Ok(zed::Command {
                command: binary,
                args,
                env,
            })
        }
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

        // 1. Explicit override from settings (`lsp.otelcol.binary.path`): the
        //    escape hatch for local server development. A `.js` override is run
        //    through Node by `build_command`.
        if let Some(command) = binary_settings.as_ref().and_then(|s| s.path.clone()) {
            let args = binary_settings
                .as_ref()
                .and_then(|s| s.arguments.clone())
                .filter(|a| !a.is_empty())
                .unwrap_or_else(Self::default_args);

            return Self::build_command(command, args, env);
        }

        // 2. A server already on PATH (e.g. a global `npm i -g`) wins over an
        //    extension-managed copy, so power users stay in control. `which`
        //    can resolve to the package's raw `.js` bin shim; `build_command`
        //    wraps that with Node.
        if let Some(path) = worktree.which(LSP_NAME) {
            return Self::build_command(path, Self::default_args(), env);
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

#[cfg(test)]
mod tests {
    use super::{needs_node_wrapper, OtelcolExtension};

    // The wrap decision, at the boundaries that matter. Note the npm bin shim
    // installed on PATH is named `otelcol-language-server` (no extension), so
    // the common tier-2 case is the *false* row here; it runs via its shebang.
    // A `.js` target only appears from a `binary.path` override or a `which`
    // that canonicalises to the script.
    #[test]
    fn node_wrapper_decision_by_extension() {
        // Wrap: an explicit `.js` script target.
        assert!(needs_node_wrapper("/x/otelcol-language-server.js"));

        // Don't wrap: native binary or the npm PATH shim (no extension).
        assert!(!needs_node_wrapper("/usr/local/bin/otelcol-language-server"));
        assert!(!needs_node_wrapper("otelcol-language-server"));

        // Conscious limitation: only `.js` is wrapped. The published bin is
        // CommonJS `.js`; if it ever ships as `.mjs`/`.cjs` this must widen.
        assert!(!needs_node_wrapper("/x/server.mjs"));
        assert!(!needs_node_wrapper("/x/server.cjs"));
        // `.js` must be the final segment, not merely present in the path.
        assert!(!needs_node_wrapper("/x/js/otelcol-language-server"));
    }

    // Behavioural test on the branch that is reachable off-wasm: a native
    // target is passed straight through, args and order preserved. (The `.js`
    // branch calls `zed::node_binary_path()`, a wasm host import that traps on
    // the host target, so its Command output can't be asserted here.)
    #[test]
    fn build_command_passes_native_binary_through() {
        let cmd = OtelcolExtension::build_command(
            "/usr/local/bin/otelcol-language-server".into(),
            vec!["--stdio".into()],
            vec![],
        )
        .expect("native binary path builds a command");

        assert_eq!(cmd.command, "/usr/local/bin/otelcol-language-server");
        assert_eq!(cmd.args, vec!["--stdio".to_string()]);
    }
}
