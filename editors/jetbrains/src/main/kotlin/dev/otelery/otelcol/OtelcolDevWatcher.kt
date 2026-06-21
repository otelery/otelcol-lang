package dev.otelery.otelcol

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.wm.ToolWindowManager
import com.redhat.devtools.lsp4ij.LanguageServerManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardWatchEventKinds

// Dev convenience: when OTELCOL_DEV_WATCH=1 is set in the IDE process env,
// watch the configured server.js and restart the LSP server on change. Pairs
// with `npm run watch` so editing TS source rebuilds dist/server/server.js
// and the sandbox IDE picks it up automatically. The watched path is the
// resolved server path the factory would launch — either the override
// (-Dotelcol.lsp.server / otelcol.lsp.server.path) or the bundled extraction.
//
// Unified across VS Code + JetBrains: same env var, same opt-in. No editor
// auto-enables it via dev-mode detection.
class OtelcolDevWatcher : ProjectActivity {
  override suspend fun execute(project: Project) {
    if (System.getenv(DEV_WATCH_ENV) != "1") return

    // Auto-open the LSP4IJ "Language Servers" console — without it you'd
    // have to fish through View → Tool Windows on every sandbox launch to
    // see protocol traffic and server lifecycle.
    showLanguageServersToolWindow(project)

    val raw = System.getProperty(OtelcolLspServerFactory.PROP_SERVER)
      ?: Registry.stringValue(OtelcolLspServerFactory.REG_SERVER_PATH).takeIf { it.isNotBlank() }
      ?: run {
        LOG.info("dev watcher: $DEV_WATCH_ENV=1 but no override path; nothing to watch")
        return
      }
    val target = Paths.get(raw).toAbsolutePath()
    val dir = target.parent ?: return
    if (!Files.isDirectory(dir)) return

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    scope.launch { runWatcher(project, target, dir, scope) }
  }

  private suspend fun showLanguageServersToolWindow(project: Project) {
    withContext(Dispatchers.Main) {
      val tw = ToolWindowManager.getInstance(project).getToolWindow("Language Servers")
      if (tw == null) {
        LOG.info("dev watcher: Language Servers tool window not registered (LSP4IJ missing?)")
        return@withContext
      }
      tw.show()
      LOG.info("dev watcher: opened Language Servers tool window")
    }
  }

  private suspend fun runWatcher(project: Project, target: Path, dir: Path, scope: CoroutineScope) {
    val ws = FileSystems.getDefault().newWatchService()
    LOG.info("dev watcher: monitoring $target for changes")
    var debounce: Job? = null
    try {
      dir.register(ws, StandardWatchEventKinds.ENTRY_MODIFY, StandardWatchEventKinds.ENTRY_CREATE)
      while (true) {
        val key = runCatching { ws.take() }.getOrNull() ?: break
        val touched = key.pollEvents().any { ev ->
          val ctx = ev.context() as? Path ?: return@any false
          dir.resolve(ctx).toAbsolutePath() == target
        }
        if (!key.reset()) break
        if (!touched) continue
        debounce?.cancel()
        debounce = scope.launch {
          delay(300)
          restart(project, target)
        }
      }
    } finally {
      runCatching { ws.close() }
    }
  }

  private suspend fun restart(project: Project, target: Path) = withContext(Dispatchers.IO) {
    LOG.info("dev watcher: $target changed — restarting LSP server")
    runCatching {
      val mgr = LanguageServerManager.getInstance(project)
      mgr.stop(OtelcolLspServerFactory.SERVER_ID)
      mgr.start(OtelcolLspServerFactory.SERVER_ID)
    }.onFailure { LOG.warn("dev watcher: restart failed", it) }
  }

  companion object {
    private val LOG = Logger.getInstance(OtelcolDevWatcher::class.java)
    // Unified flag across editors. Set to "1" to enable the auto-restart
    // watcher; absent / any other value = disabled.
    const val DEV_WATCH_ENV = "OTELCOL_DEV_WATCH"
  }
}
