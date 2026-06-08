use zed_extension_api::{
    self as zed,
    serde_json,
    settings::LspSettings,
    LanguageServerId, Result, Worktree,
};

const LSP_NAME: &str = "otelcol-language-server";
const SERVER_ID: &str = "otelcol";

struct OtelcolExtension;

impl OtelcolExtension {
    fn default_args() -> Vec<String> {
        vec!["--stdio".into()]
    }
}

impl zed::Extension for OtelcolExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
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

        if let Some(command) = binary_settings.as_ref().and_then(|s| s.path.clone()) {
            let args = binary_settings
                .as_ref()
                .and_then(|s| s.arguments.clone())
                .filter(|a| !a.is_empty())
                .unwrap_or_else(Self::default_args);

            return Ok(zed::Command { command, args, env });
        }

        if let Some(path) = worktree.which(LSP_NAME) {
            return Ok(zed::Command {
                command: path,
                args: Self::default_args(),
                env,
            });
        }

        Err(format!(
            "{LSP_NAME} not found.\n\
             For local dev, set in Zed settings.json:\n  \
             \"lsp\": {{ \"{SERVER_ID}\": {{ \"binary\": {{ \"path\": \
             \"/abs/path/to/repo/bin/otelcol-language-server.js\", \
             \"arguments\": [\"--stdio\"] }} }} }}\n\
             Or install globally: `npm i -g vscode-otelcol`."
        ))
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
