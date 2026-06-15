package ch.snowgarden.otelcol

import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.redhat.devtools.lsp4ij.LanguageServerManager

// Tools → Restart otelcol Language Server. Mirrors the one-click restart
// affordance Vue/Astro/Prisma expose via restartTypeScriptServicesAsync and
// SonarLint exposes via RestartBackendAction — saves users from clicking
// through LSP Consoles after a `make bundle`.
class RestartOtelcolServerAction : DumbAwareAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val mgr = LanguageServerManager.getInstance(project)
    mgr.stop(OtelcolLspServerFactory.SERVER_ID)
    mgr.start(OtelcolLspServerFactory.SERVER_ID)
  }

  override fun update(e: AnActionEvent) {
    e.presentation.isEnabled = e.project != null
  }
}
