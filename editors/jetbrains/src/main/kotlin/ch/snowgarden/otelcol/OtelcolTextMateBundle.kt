package ch.snowgarden.otelcol

import com.intellij.openapi.application.PathManager
import org.jetbrains.plugins.textmate.api.TextMateBundleProvider
import java.nio.file.Path
import java.nio.file.Paths

class OtelcolTextMateBundle : TextMateBundleProvider {
  override fun getBundles(): List<TextMateBundleProvider.PluginBundle> {
    val pluginPath = PathManager.getPluginsPath()
    val bundleRoot = Paths.get(pluginPath, "otelcol-jetbrains", "textmate")
    return listOf(
      TextMateBundleProvider.PluginBundle("otelcol", bundleRoot),
    )
  }
}
