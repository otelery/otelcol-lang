package ch.snowgarden.otelcol

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.EnvironmentUtil
import com.intellij.execution.configurations.PathEnvironmentVariableUtil
import com.redhat.devtools.lsp4ij.LanguageServerFactory
import com.redhat.devtools.lsp4ij.client.features.LSPClientFeatures
import com.redhat.devtools.lsp4ij.server.ProcessStreamConnectionProvider
import com.redhat.devtools.lsp4ij.server.StreamConnectionProvider
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

class OtelcolLspServerFactory : LanguageServerFactory {
  override fun createConnectionProvider(project: Project): StreamConnectionProvider {
    val command = buildCommand()
    return object : ProcessStreamConnectionProvider(command, project.basePath) {
      override fun getInitializationOptions(rootUri: VirtualFile?): Any = INIT_OPTIONS

      // Resolve the CWD lazily at fork time, falling back to ${user.home}
      // if the configured dir no longer exists. Covers two cases:
      //   - BasePlatformTestCase tears down its temp project dir before
      //     the async LSP spawn fires → fork() would fail with ENOENT.
      //   - Real users whose project root was renamed/deleted while the
      //     IDE was running.
      override fun getWorkingDirectory(): String? {
        val stored = super.getWorkingDirectory()
        if (stored != null && Files.isDirectory(Paths.get(stored))) return stored
        return System.getProperty("user.home")
      }
    }.also {
      // Hand the spawned `node` the shell-inherited env (PATH, NODE_PATH, ...).
      // Without this, GUI-launched IDEs on Linux/macOS spawn children with the
      // launcher's PATH, which typically excludes ~/.nvm, /usr/local/bin, etc.,
      // breaking transitive `require()` lookups inside the bundle.
      it.userEnvironmentVariables = EnvironmentUtil.getEnvironmentMap()
    }
  }

  // Defence-in-depth against LSP4IJ's verbatim snippet expansion: rewrite
  // any `\t` continuation indent into the cursor line's actual whitespace
  // before lookup elements are constructed. See OtelcolLspCompletionFeature
  // for the why.
  override fun createClientFeatures(): LSPClientFeatures =
    LSPClientFeatures().setCompletionFeature(OtelcolLspCompletionFeature())

  // Visible for testing. Override priority: PROP_COMMAND (full argv0) >
  // PROP_SERVER (system property, dev-only) > REG_SERVER_PATH (persistent
  // Registry override) > bundled+extracted.
  internal fun buildCommand(): List<String> {
    System.getProperty(PROP_COMMAND)?.let { return listOf(it, "--stdio") }
    val nodeBin = resolveNode()
    val serverJs = System.getProperty(PROP_SERVER)
      ?: Registry.stringValue(REG_SERVER_PATH).takeIf { it.isNotBlank() }
      ?: extractBundledServer().toAbsolutePath().toString()
    return listOf(nodeBin, serverJs, "--stdio")
  }

  // Visible for testing.
  internal fun resolveNode(): String {
    System.getProperty(PROP_NODE)?.let { return it }
    // EnvironmentUtil exposes the shell-inherited PATH — required because
    // GUI-launched IDEs on macOS/Linux otherwise inherit a stripped PATH
    // that typically excludes Homebrew, nvm, /usr/local/bin, etc.
    val shellPath = EnvironmentUtil.getValue("PATH")
    PathEnvironmentVariableUtil.findInPath("node", shellPath, null)?.let {
      return it.absolutePath
    }
    // Last resort: hand the literal "node" to the OS — the spawned process
    // inherits the shell env (set in createConnectionProvider) so PATH lookup
    // may still succeed. If not, the user gets an IOException and reaches for
    // the otelcol.lsp.node override.
    return "node"
  }

  // Visible for testing. Reuses the cached extraction when the bundled bytes
  // haven't changed; otherwise re-extracts. The hash sidecar is what makes
  // `make build-jetbrains` + reinstall pick up a new server.js without users
  // having to manually wipe ~/.cache/JetBrains/.../otelcol-language-server/.
  internal fun extractBundledServer(): Path {
    val root = Paths.get(PathManager.getSystemPath(), "otelcol-language-server", PLUGIN_VERSION)
    val stamp = root.resolve(".content.sha256")
    val bundledHash = bundledManifestHash()
    val serverJs = root.resolve("server").resolve("server.js")
    if (Files.exists(stamp) && Files.exists(serverJs) &&
      runCatching { Files.readString(stamp).trim() }.getOrNull() == bundledHash
    ) {
      return serverJs
    }
    extractTo(root)
    Files.writeString(stamp, bundledHash)
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

  // Hash of the bundled tree, as emitted by the copyLanguageServer Gradle
  // task into language-server/manifest.sha256. Falls back to hashing the
  // manifest contents if the sidecar is missing (older plugin builds).
  private fun bundledManifestHash(): String {
    val cl = OtelcolLspServerFactory::class.java.classLoader
    cl.getResourceAsStream("language-server/manifest.sha256")?.use {
      return it.bufferedReader().readText().trim()
    }
    val manifest = cl.getResourceAsStream("language-server/manifest.txt")?.use {
      it.bufferedReader().readText()
    } ?: ""
    val md = MessageDigest.getInstance("SHA-256")
    return md.digest(manifest.toByteArray()).joinToString("") { "%02x".format(it) }
  }

  companion object {
    internal const val PROP_COMMAND = "otelcol.lsp.command"
    internal const val PROP_NODE = "otelcol.lsp.node"
    // Path to a server.js to launch via the resolved node binary. Useful for
    // dev: point at the source-tree bundle so reinstalling the plugin isn't
    // required after a `make bundle`. Ignored when PROP_COMMAND is set.
    internal const val PROP_SERVER = "otelcol.lsp.server"
    // Persistent override for the server.js path, editable via Help → Find
    // Action → Registry…. Empty string = use bundled. Lower priority than
    // PROP_SERVER so dev-time system-prop wins over a forgotten Registry value.
    internal const val REG_SERVER_PATH = "otelcol.lsp.server.path"
    // Bumped manually with pluginVersion in gradle.properties. The directory
    // segregates per-plugin-version extractions; cache invalidation within a
    // version is by content hash (extractBundledServer).
    private const val PLUGIN_VERSION = "0.1.0"
    // Server ID matches the <server id="otelcol"…/> declared in plugin.xml.
    // Used by RestartOtelcolServerAction to bounce the running process.
    internal const val SERVER_ID = "otelcol"
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
