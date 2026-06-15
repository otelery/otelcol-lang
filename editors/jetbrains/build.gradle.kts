import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import java.io.File
import java.security.MessageDigest

plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "2.4.0"
  id("org.jetbrains.intellij.platform") version "2.16.0"
  // Reports out-of-date dependencies via `gradle dependencyUpdates`.
  // Wired into the repo-level `make outdated`.
  id("com.github.ben-manes.versions") version "0.54.0"
  // Rewrites version literals in build.gradle.kts to the latest versions
  // reported by `dependencyUpdates`. Wired into `make upgrade-gradle-jetbrains`.
  id("se.patrikerdes.use-latest-versions") version "0.2.18"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
  mavenCentral()
  intellijPlatform {
    defaultRepositories()
  }
}

dependencies {
  intellijPlatform {
    create(
      providers.gradleProperty("platformType"),
      providers.gradleProperty("platformVersion"),
    )

    // Bundled TextMate plugin — used to render highlighting from the
    // shared syntaxes/*.tmLanguage.json grammars.
    bundledPlugin("org.jetbrains.plugins.textmate")

    // YAML plugin — required for YAMLLanguage.INSTANCE in OtelcolFileType.
    bundledPlugin("org.jetbrains.plugins.yaml")

    // LSP4IJ — Marketplace plugin that gives Community editions an
    // LSP client. Both client and SDK come from this dep.
    plugin(
      providers.gradleProperty("lsp4ijPluginId").get(),
      providers.gradleProperty("lsp4ijPluginVersion").get(),
    )

    testFramework(TestFrameworkType.Platform)
  }
  // JUnit 3/4 is required at test-compile time because BasePlatformTestCase
  // extends junit.framework.TestCase (JUnit 3 style).
  testImplementation("junit:junit:4.13.2")
  // opentest4j is a transitive runtime dep of the IntelliJ test framework.
  testRuntimeOnly("org.opentest4j:opentest4j:1.3.0")
}

intellijPlatform {
  pluginConfiguration {
    id = providers.gradleProperty("pluginGroup")
    // Do not override `name` here. plugin.xml's <name>OpenTelemetry Collector
    // Config</name> is the canonical display name; piping `pluginName` through
    // would inject "JetBrains" (the artifact slug) into the marketplace title,
    // which Plugin Verifier rejects as TemplateWordInPluginName.
    version = providers.gradleProperty("pluginVersion")

    ideaVersion {
      sinceBuild = providers.gradleProperty("pluginSinceBuild")
      untilBuild = providers.gradleProperty("pluginUntilBuild")
    }
  }

  // Plugin Verifier — official JetBrains static-analysis tool.
  // Catches undeclared <depends>, missing classes, deprecated API across the
  // declared sinceBuild..untilBuild range. Would have caught the
  // YAMLLanguage NoClassDefFoundError that slipped past unit tests, because
  // the verifier exercises the strict production classloader.
  // Run via `./gradlew verifyPlugin` or `make verify-jetbrains`.
  pluginVerification {
    ides {
      recommended()
    }
    failureLevel = listOf(
      org.jetbrains.intellij.platform.gradle.tasks.VerifyPluginTask.FailureLevel.COMPATIBILITY_PROBLEMS,
      org.jetbrains.intellij.platform.gradle.tasks.VerifyPluginTask.FailureLevel.MISSING_DEPENDENCIES,
      org.jetbrains.intellij.platform.gradle.tasks.VerifyPluginTask.FailureLevel.NOT_DYNAMIC,
    )
  }
}

kotlin {
  jvmToolchain(17)
}

// --- Bundled assets ---------------------------------------------------------
// Both TextMate grammars and the LSP server bundle are produced by tools
// outside this Gradle module; we copy them into src/main/resources/ so they
// land on the plugin classpath. The LSP server is extracted from the jar to
// a stable PathManager cache on first activation (OtelcolLspServerFactory).

val syntaxesSource = file("../../syntaxes")
val syntaxesTarget = file("src/main/resources/textmate")

val languageServerSource = file("../../dist/server")
val schemasSource = file("../../dist/schemas")
val languageServerTarget = file("src/main/resources/language-server")

val copySyntaxes by tasks.registering(Copy::class) {
  from(syntaxesSource) {
    include("*.tmLanguage.json")
    include("*.injection.json")
  }
  into(syntaxesTarget)
}

val copyLanguageServer by tasks.registering(Copy::class) {
  description = "Stage bundled otelcol-language-server (esbuild output) + JSON schemas into plugin resources"
  doFirst {
    require(file("$languageServerSource/server.js").exists()) {
      "Missing dist/server/server.js — run `make bundle` from the repo root first."
    }
    require(schemasSource.exists()) {
      "Missing dist/schemas/ — run `make bundle` from the repo root first."
    }
  }
  from(languageServerSource) {
    include("server.js")
    into("server")
  }
  from(schemasSource) {
    into("schemas")
  }
  into(languageServerTarget)
  doLast {
    // Self-describing manifest of relative paths. OtelcolLspServerFactory reads
    // this at runtime to know which classpath resources to extract to disk.
    val manifest = fileTree(languageServerTarget) {
      exclude("manifest.txt")
      exclude("manifest.sha256")
    }.files
      .map { it.toRelativeString(languageServerTarget).replace(File.separatorChar, '/') }
      .sorted()
    file("$languageServerTarget/manifest.txt").writeText(manifest.joinToString("\n") + "\n")
    // Content hash of the bundled tree. OtelcolLspServerFactory uses this to
    // invalidate its on-disk extraction cache when the bundled bytes change —
    // so reinstalling a freshly-built zip no longer requires manually wiping
    // ~/.cache/JetBrains/.../otelcol-language-server/.
    val md = MessageDigest.getInstance("SHA-256")
    manifest.forEach { rel ->
      md.update(rel.toByteArray(Charsets.UTF_8))
      md.update(0)
      md.update(file("$languageServerTarget/$rel").readBytes())
    }
    val hex = md.digest().joinToString("") { b: Byte -> "%02x".format(b) }
    file("$languageServerTarget/manifest.sha256").writeText(hex + "\n")
  }
}

tasks.named("processResources") {
  dependsOn(copySyntaxes, copyLanguageServer)
}

// `./gradlew runIdeDev` — sandbox IDE pre-wired for plugin development.
// Decoupled from the build's `platformVersion` (which targets sinceBuild=243
// as a compile-time floor) by registering a separate runIde task pinned to
// `runIdeVersion` from gradle.properties. Mirrors VS Code's F5 setup: opens
// the repo's examples/ as the sandbox project, points the LSP server
// override at dist/server/server.js, and enables the dev watcher.
//
// Override IDE version: -PrunIdeVersion=2026.2
// Override project:    -PsandboxProject=/abs/path
intellijPlatformTesting {
  runIde.register("runIdeDev") {
    // Starting with 2025.3 (253), JetBrains dropped the IC/IU split — there
    // is only one `intellijIdea` artifact. Use the unified type so 2026.x
    // versions resolve.
    type = org.jetbrains.intellij.platform.gradle.IntelliJPlatformType.IntellijIdea
    version = providers.gradleProperty("runIdeVersion")
    plugins {
      plugin(
        providers.gradleProperty("lsp4ijPluginId").get(),
        providers.gradleProperty("lsp4ijPluginVersion").get(),
      )
    }
    task {
      val repoRoot = rootDir.parentFile.parentFile
      val sandboxProject = (project.findProperty("sandboxProject") as String?)
        ?: File(repoRoot, "examples").absolutePath
      setArgs(listOf(sandboxProject))
      systemProperty(
        "otelcol.lsp.server",
        File(repoRoot, "dist/server/server.js").absolutePath,
      )
      // Same env var the VS Code extension checks; unified opt-in. Defaults
      // to "1" but respects the shell value, so `OTELCOL_DEV_WATCH=0 make
      // runide-jetbrains` disables the watcher without editing the script.
      environment("OTELCOL_DEV_WATCH", System.getenv("OTELCOL_DEV_WATCH") ?: "1")

      // Verbose logging is wired BOTH ways: system properties (apply at
      // startup, no UI footprint) AND options/log-categories.xml (UI mirror
      // so Help → Diagnostic Tools → Debug Log Settings shows the same
      // categories). The system-property path is the safety net in case
      // the file schema drifts across IDE versions.
      //
      // Auto-trust + skipping the Trust dialog is done via options/
      // trusted-paths.xml — idea.trust.all.projects=true is unreliable on
      // 2025.3+ since JetBrains tightened the gate.
      //
      // Override via gradle property if needed:
      //   ./gradlew runIdeDev -PlogDebug="extra.cat" -PlogTrace="other.cat"
      val debugCats = (project.findProperty("logDebug") as String?)
        ?: "com.redhat.devtools.lsp4ij,org.eclipse.lsp4j"
      val traceCats = (project.findProperty("logTrace") as String?)
        ?: "ch.snowgarden.otelcol"
      systemProperty("idea.log.debug.categories", debugCats)
      systemProperty("idea.log.trace.categories", traceCats)

      doFirst {
        // Sandbox layout produced by the intellij-platform plugin:
        //   editors/jetbrains/.intellijPlatform/sandbox/<pluginName>/<type>-<version>/config_runIdeDev/options/
        val pluginNameRes = providers.gradleProperty("pluginName").get()
        val platformTypeRes = providers.gradleProperty("platformType").get()
        val platformVersionRes = providers.gradleProperty("platformVersion").get()
        val configDir = projectDir
          .resolve(".intellijPlatform/sandbox/$pluginNameRes/$platformTypeRes-$platformVersionRes/config_runIdeDev/options")
        configDir.mkdirs()

        // Trust the sandbox project up-front, so the dialog never appears.
        configDir.resolve("trusted-paths.xml").writeText(
          """
          |<application>
          |  <component name="Trusted.Paths">
          |    <option name="TRUSTED_PROJECT_PATHS">
          |      <map>
          |        <entry key="$sandboxProject" value="true" />
          |      </map>
          |    </option>
          |  </component>
          |</application>
          |
          """.trimMargin()
        )

        // Pre-populate Debug Log Settings (Help → Diagnostic Tools → …) so
        // the UI mirrors what's active. Schema matches IntelliJ's
        // LogLevelConfigurationManager.State: {"categories":[{"category":
        // "<cat>","level":"DEBUG|TRACE"}]}.
        val entries = buildList {
          debugCats.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            .forEach { add(""""category":"$it","level":"DEBUG"""") }
          traceCats.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            .forEach { add(""""category":"$it","level":"TRACE"""") }
        }
        val json = entries.joinToString(",", """{"categories":[""", "]}") { "{$it}" }
        configDir.resolve("log-categories.xml").writeText(
          """
          |<application>
          |  <component name="Logs.Categories"><![CDATA[$json]]></component>
          |</application>
          |
          """.trimMargin()
        )
      }
      // `idea.is.internal=true` is already set by the platform plugin in
      // sandbox mode — that's what unlocks the in-log error-reporter dialog
      // and the extra assertion checks. No extra wiring needed.
    }
  }
}

tasks.named("clean") {
  doLast {
    syntaxesTarget.deleteRecursively()
    languageServerTarget.deleteRecursively()
  }
}

// Integration tests (IDE Starter / IntegrationTestApplication) are tracked as
// a separate follow-up. The Plugin Verifier above already catches the
// classloader bugs that motivated this layer (e.g. the missing
// `<depends>org.jetbrains.plugins.yaml</depends>` regression), so we ship
// verifier coverage first and revisit IDE Starter once a Docker-capable CI
// runner is available.
// Reference: https://blog.jetbrains.com/platform/2025/02/integration-tests-for-plugin-developers-intro-dependencies-and-first-integration-test/
