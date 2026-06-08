package ch.snowgarden.otelcol

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.redhat.devtools.lsp4ij.LanguageServerFactory
import com.redhat.devtools.lsp4ij.server.ProcessStreamConnectionProvider
import com.redhat.devtools.lsp4ij.server.StreamConnectionProvider

class OtelcolLspServerFactory : LanguageServerFactory {
  override fun createConnectionProvider(project: Project): StreamConnectionProvider {
    val command = listOf(
      System.getProperty("otelcol.lsp.command") ?: "otelcol-language-server",
      "--stdio",
    )
    return object : ProcessStreamConnectionProvider(command, project.basePath) {
      override fun getInitializationOptions(rootUri: VirtualFile?): Any {
        return mapOf(
          "otelcol" to mapOf(
            "distribution" to "otelcol-contrib",
            "configSets" to mapOf(
              "autoDiscover" to true,
              "maxFilesScanned" to 2000,
            ),
          ),
        )
      }
    }
  }
}
