package ch.snowgarden.otelcol

import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileTypes.LanguageFileType
import com.intellij.openapi.fileTypes.ex.FileTypeIdentifiableByVirtualFile
import com.intellij.openapi.vfs.VirtualFile
import org.jetbrains.yaml.YAMLLanguage
import javax.swing.Icon

// Detection has two layers, mirroring the VS Code extension:
//   - Filename globs (`*.otelcol.yaml`, `*.otelcol.yml`, `otelcol-configset.yaml`)
//     declared via <fileType patterns> in plugin.xml — the cheap, no-I/O path.
//   - Content sniffing in isMyFileType below, a Kotlin port of
//     src/common/yaml-sniff.ts. Because the YAML plugin owns `*.yaml`/`*.yml`
//     by extension, a plain content FileTypeDetector is never consulted for
//     them; a FileTypeIdentifiableByVirtualFile ("special" file type) *is*
//     checked before name matchers, so it can reclaim a plain *.yaml that is
//     actually collector config — exactly what the VS Code sniffer does by
//     retagging the open document client-side.
class OtelcolFileType private constructor() :
  LanguageFileType(YAMLLanguage.INSTANCE, true), FileTypeIdentifiableByVirtualFile {
  override fun getName(): String = "OpenTelemetry Collector"
  override fun getDescription(): String = "OpenTelemetry Collector configuration"
  override fun getDefaultExtension(): String = "otelcol.yaml"
  override fun getIcon(): Icon? = null

  // Called for every file during type resolution, so it must stay cheap: bail
  // on non-YAML names before touching content, and only fall through to a
  // sibling scan for single-otelcol-key fragments (the narrow case the VS Code
  // sniffer also reserves the scan for). Any I/O failure → not our type.
  override fun isMyFileType(file: VirtualFile): Boolean {
    if (file.isDirectory) return false
    val name = file.name
    if (matchesGlob(name)) return true // fast path, no I/O
    if (!isYaml(name)) return false
    return runCatching { looksLikeOtelcol(file) }.getOrElse { err ->
      LOG.debug("otelcol content sniff failed for ${file.path}", err)
      false
    }
  }

  // Port of looksLikeOtelcol() in src/common/yaml-sniff.ts — same rules, same
  // order, first match wins.
  private fun looksLikeOtelcol(file: VirtualFile): Boolean {
    val head = readHead(file) ?: return false

    // Rule 1: directive marker comment anywhere in the head.
    if (OtelcolYamlClassify.DIRECTIVE_MARKER_RE.containsMatchIn(head)) return true

    // Rule 2: filename is the sidecar manifest.
    val selfName = file.name
    if (selfName == OtelcolYamlClassify.SIDECAR_NAME) return true

    // Rule 3: self structure — anchor, or ≥2 otelcol keys. Zero keys → never
    // ours, and skip the sibling scan entirely.
    val self = OtelcolYamlClassify.classify(head)
    if (self.hasPipelines) return true
    if (self.otelcolKeys >= 2) return true
    if (self.otelcolKeys == 0) return false

    // Single-key fragment: only meaningful next to an anchor / sidecar.
    val dir = file.parent ?: return false

    // Rule 4: a sibling sidecar exists in the same directory.
    if (dir.findChild(OtelcolYamlClassify.SIDECAR_NAME) != null) return true

    // Rule 5: a sibling names this file via a directive, or is itself an anchor.
    var scanned = 0
    for (child in dir.children) {
      if (scanned >= SIBLING_SCAN_LIMIT) break
      if (child.isDirectory || !isYaml(child.name) || child.name == selfName) continue
      scanned++
      val h = readHead(child) ?: continue
      val sib = OtelcolYamlClassify.classify(h)
      if (sib.directive?.contains(selfName) == true) return true // rule 5a
      if (sib.hasPipelines) return true // rule 5b
    }
    return false
  }

  companion object {
    private val LOG = logger<OtelcolFileType>()

    // Mirrors SIBLING_SCAN_LIMIT in src/common/yaml-sniff.ts.
    private const val SIBLING_SCAN_LIMIT = 50

    @JvmField val INSTANCE: OtelcolFileType = OtelcolFileType()

    private val YAML_RE = Regex("\\.ya?ml$", RegexOption.IGNORE_CASE)

    private fun isYaml(name: String): Boolean = YAML_RE.containsMatchIn(name)

    private fun matchesGlob(name: String): Boolean =
      name.endsWith(".otelcol.yaml", ignoreCase = true) ||
        name.endsWith(".otelcol.yml", ignoreCase = true) ||
        name == OtelcolYamlClassify.SIDECAR_NAME

    // Read up to HEAD_BYTES of the file as UTF-8. Returns null on any read
    // failure (binary, deleted mid-scan, unreadable during indexing, …).
    private fun readHead(file: VirtualFile): String? = try {
      file.inputStream.use { stream ->
        val buf = ByteArray(OtelcolYamlClassify.HEAD_BYTES)
        var off = 0
        while (off < buf.size) {
          val n = stream.read(buf, off, buf.size - off)
          if (n < 0) break
          off += n
        }
        String(buf, 0, off, Charsets.UTF_8)
      }
    } catch (e: Exception) {
      null
    }
  }
}
