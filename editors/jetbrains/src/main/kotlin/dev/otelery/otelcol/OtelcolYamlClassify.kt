package dev.otelery.otelcol

// Kotlin port of src/common/yaml-classify.ts. Kept structurally identical so
// the JetBrains content-based file-type detection (OtelcolFileType) stays in
// sync with the VS Code sniffer — the two layers previously drifted (see the
// staging-blank-line regression noted in the TS source).
//
// Unlike the TS version (which runs a real YAML parser), this uses a
// line-based top-level scan. File-type detection runs on every file lookup
// and must stay cheap, so we avoid pulling in / driving a YAML parser here;
// recognising top-level mapping keys and a `service.pipelines` child is all
// the classifier needs.
object OtelcolYamlClassify {
  // Top-level keys that mark a file as otelcol config. `service` is included
  // because a file with just `service:` is still collector-shaped.
  val OTELCOL_TOP_KEYS = setOf(
    "service", "receivers", "processors", "exporters", "connectors", "extensions",
  )

  // Fragment-only keys: a file with one of these (but no `service`) is a
  // fragment that must be paired with an anchor to be meaningful.
  val FRAGMENT_KEYS = setOf(
    "receivers", "processors", "exporters", "connectors", "extensions",
  )

  const val SIDECAR_NAME = "configset.otelcol.yaml"
  const val HEAD_BYTES = 16 * 1024

  // `# configset-otelcol:` anywhere in the head (the "is this declared as part
  // of a configset" marker check).
  val DIRECTIVE_MARKER_RE = Regex("^#\\s*configset-otelcol:", RegexOption.MULTILINE)

  data class Classification(
    /** `service.pipelines` exists at the top level — this is an anchor. */
    val hasPipelines: Boolean,
    /** Number of top-level keys in `OTELCOL_TOP_KEYS`. */
    val otelcolKeys: Int,
    /** Whether any top-level key is in `FRAGMENT_KEYS`. */
    val hasFragmentKeys: Boolean,
    /**
     * Members named by a first-line `# configset-otelcol:` directive, or `null`
     * if the file has no such directive. Names are verbatim, not resolved.
     */
    val directive: List<String>?,
  )

  private val TOP_KEY_RE = Regex("^([A-Za-z0-9_.-]+)\\s*:(\\s.*)?$")
  private val DIRECTIVE_FIRST_RE = Regex("^#\\s*configset-otelcol:\\s*(.+)$")

  fun classify(text: String): Classification {
    val head = if (text.length > HEAD_BYTES) text.substring(0, HEAD_BYTES) else text
    // Split once, normalising CRLF so first-char / indent checks aren't fooled
    // by a trailing '\r'.
    val lines = head.split("\n").map { it.removeSuffix("\r") }
    val directive = parseDirective(lines)

    var otelcolKeys = 0
    var hasFragmentKeys = false
    var hasPipelines = false

    for (i in lines.indices) {
      val key = topLevelKey(lines[i]) ?: continue
      if (OTELCOL_TOP_KEYS.contains(key)) otelcolKeys++
      if (FRAGMENT_KEYS.contains(key)) hasFragmentKeys = true
      if (key == "service" && serviceHasPipelines(lines, i)) hasPipelines = true
    }

    return Classification(hasPipelines, otelcolKeys, hasFragmentKeys, directive)
  }

  // A top-level mapping key: zero indentation, not a comment / list item / doc
  // marker. Returns the key name, or null if the line is not a top-level key.
  private fun topLevelKey(line: String): String? {
    if (line.isEmpty()) return null
    when (line[0]) {
      ' ', '\t', '#', '-' -> return null
    }
    return TOP_KEY_RE.matchEntire(line.trimEnd())?.groupValues?.get(1)
  }

  // Looks for a `pipelines:` direct child within the `service:` block that
  // starts at lines[serviceIdx]. Direct-child only (matches the TS check of
  // `"pipelines" in service`), so a deeply-nested `pipelines:` won't false-hit.
  private fun serviceHasPipelines(lines: List<String>, serviceIdx: Int): Boolean {
    var childIndent = -1
    var i = serviceIdx + 1
    while (i < lines.size) {
      val line = lines[i]
      if (line.isBlank()) { i++; continue }
      val indent = leadingSpaces(line)
      if (indent == 0) break // next top-level key ends the service block
      val trimmed = line.trimStart()
      if (trimmed.startsWith("#")) { i++; continue }
      if (childIndent == -1) childIndent = indent
      if (indent == childIndent && TOP_KEY_RE.matchEntire(trimmed.trimEnd())?.groupValues?.get(1) == "pipelines") {
        return true
      }
      i++
    }
    return false
  }

  private fun leadingSpaces(line: String): Int {
    var n = 0
    for (ch in line) {
      if (ch == ' ' || ch == '\t') n++ else break
    }
    return n
  }

  private fun parseDirective(lines: List<String>): List<String>? {
    val first = lines.firstOrNull() ?: return null
    val m = DIRECTIVE_FIRST_RE.matchEntire(first.trim()) ?: return null
    return m.groupValues[1].trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
  }
}
