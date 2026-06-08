package ch.snowgarden.otelcol

import com.intellij.openapi.fileTypes.LanguageFileType
import org.jetbrains.yaml.YAMLLanguage
import javax.swing.Icon

// Glob-based detection only for v0.1. The VS Code extension does a
// full content sniff (src/common/yaml-classify.ts) — porting that
// to Kotlin is a follow-up; users with arbitrary *.yaml files using
// the `# otelcol-configset:` directive need to add the
// `.otelcol.yaml` suffix or open via Override File Type.
class OtelcolFileType private constructor() : LanguageFileType(YAMLLanguage.INSTANCE, true) {
  override fun getName(): String = "OpenTelemetry Collector"
  override fun getDescription(): String = "OpenTelemetry Collector configuration"
  override fun getDefaultExtension(): String = "otelcol.yaml"
  override fun getIcon(): Icon? = null

  companion object {
    @JvmField val INSTANCE: OtelcolFileType = OtelcolFileType()
  }
}
