package ch.snowgarden.otelcol

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.EnvironmentUtil
import com.redhat.devtools.lsp4ij.LanguageServerFactory
import com.redhat.devtools.lsp4ij.server.ProcessStreamConnectionProvider
import com.redhat.devtools.lsp4ij.server.StreamConnectionProvider
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption

class OtelcolLspServerFactory : LanguageServerFactory {
  override fun createConnectionProvider(project: Project): StreamConnectionProvider {
    val command = buildCommand()
    return object : ProcessStreamConnectionProvider(command, project.basePath) {
      override fun getInitializationOptions(rootUri: VirtualFile?): Any = INIT_OPTIONS
    }.also {
      // Hand the spawned `node` the shell-inherited env (PATH, NODE_PATH, ...).
      // Without this, GUI-launched IDEs on Linux/macOS spawn children with the
      // launcher's PATH, which typically excludes ~/.nvm, /usr/local/bin, etc.,
      // breaking transitive `require()` lookups inside the bundle.
      it.userEnvironmentVariables = EnvironmentUtil.getEnvironmentMap()
    }
  }

  // Visible for testing.
  internal fun buildCommand(): List<String> {
    System.getProperty(PROP_COMMAND)?.let { return listOf(it, "--stdio") }
    val nodeBin = resolveNode()
    val serverJs = extractBundledServer().toAbsolutePath().toString()
    return listOf(nodeBin, serverJs, "--stdio")
  }

  // Visible for testing.
  internal fun resolveNode(): String {
    // Explicit override wins.
    System.getProperty(PROP_NODE)?.let { return it }
    // Probe the shell-inherited PATH (EnvironmentUtil), then a handful of
    // common install locations the IDE's launcher PATH typically misses.
    val shellPath = EnvironmentUtil.getValue("PATH").orEmpty()
    val pathDirs = shellPath.split(java.io.File.pathSeparatorChar).filter { it.isNotBlank() }
    val candidates = pathDirs.asSequence().map { Paths.get(it, "node") } +
      WELL_KNOWN_NODE_PATHS.asSequence().map { Paths.get(it) }
    candidates.firstOrNull { Files.isExecutable(it) }?.let { return it.toAbsolutePath().toString() }
    // Last resort: hand the literal "node" to the OS and hope. If it fails the
    // user gets the IOException — at which point the override property is the
    // escape hatch.
    return "node"
  }

  // Visible for testing.
  internal fun extractBundledServer(): Path {
    val root = Paths.get(PathManager.getSystemPath(), "otelcol-language-server", PLUGIN_VERSION)
    val serverJs = root.resolve("server").resolve("server.js")
    if (Files.exists(serverJs)) return serverJs
    extractTo(root)
    return serverJs
  }

  private fun extractTo(target: Path) {
    Files.createDirectories(target)
    val cl = OtelcolLspServerFactory::class.java.classLoader
    bundledResources(cl).forEach { rel ->
      val input = cl.getResourceAsStream("language-server/$rel")
        ?: error("Bundled resource missing: language-server/$rel")
      val out = target.resolve(rel)
      Files.createDirectories(out.parent)
      input.use { Files.copy(it, out, StandardCopyOption.REPLACE_EXISTING) }
    }
  }

  private fun bundledResources(cl: ClassLoader): List<String> {
    val manifest = cl.getResourceAsStream("language-server/manifest.txt")
      ?: error(
        "language-server/manifest.txt missing on classpath — the Gradle " +
          "copyLanguageServer task did not run; rebuild with `make build-jetbrains`."
      )
    return manifest.bufferedReader().use { it.readLines() }.filter { it.isNotBlank() }
  }

  companion object {
    internal const val PROP_COMMAND = "otelcol.lsp.command"
    internal const val PROP_NODE = "otelcol.lsp.node"
    // Probed in order after the shell PATH. Covers macOS Homebrew (Intel +
    // Apple Silicon), the common Linux distro layout, and nvm's default.
    private val WELL_KNOWN_NODE_PATHS = listOf(
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/home/linuxbrew/.linuxbrew/bin/node",
      "${System.getProperty("user.home")}/.linuxbrew/bin/node",
      "/usr/bin/node",
      "${System.getProperty("user.home")}/.nvm/versions/node/current/bin/node",
      "${System.getProperty("user.home")}/.volta/bin/node",
    )
    // Bumped manually with pluginVersion in gradle.properties. The cache key
    // exists so stale extracted bundles from an older plugin install are
    // ignored after upgrade rather than re-used.
    private const val PLUGIN_VERSION = "0.1.0"
    private val INIT_OPTIONS: Map<String, Any> = mapOf(
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
