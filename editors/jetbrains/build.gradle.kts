import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import java.io.File

plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "2.4.0"
  id("org.jetbrains.intellij.platform") version "2.16.0"
  // Reports out-of-date dependencies via `gradle dependencyUpdates`.
  // Wired into the repo-level `make outdated`.
  id("com.github.ben-manes.versions") version "0.54.0"
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
    }.files
      .map { it.toRelativeString(languageServerTarget).replace(File.separatorChar, '/') }
      .sorted()
    file("$languageServerTarget/manifest.txt").writeText(manifest.joinToString("\n") + "\n")
  }
}

tasks.named("processResources") {
  dependsOn(copySyntaxes, copyLanguageServer)
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
