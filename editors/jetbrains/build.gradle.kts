import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "2.0.20"
  id("org.jetbrains.intellij.platform") version "2.1.0"
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

    instrumentationTools()
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
    name = providers.gradleProperty("pluginName")
    version = providers.gradleProperty("pluginVersion")

    ideaVersion {
      sinceBuild = providers.gradleProperty("pluginSinceBuild")
      untilBuild = providers.gradleProperty("pluginUntilBuild")
    }
  }
}

kotlin {
  jvmToolchain(17)
}

// Single-source the TextMate grammars from the repo root so VS Code
// and JetBrains never drift apart. Runs before resource processing.
val syntaxesSource = file("../../syntaxes")
val syntaxesTarget = file("src/main/resources/textmate")

val copySyntaxes by tasks.registering(Copy::class) {
  from(syntaxesSource) {
    include("*.tmLanguage.json")
    include("*.injection.json")
  }
  into(syntaxesTarget)
}

tasks.named("processResources") {
  dependsOn(copySyntaxes)
}

tasks.named("clean") {
  doLast { syntaxesTarget.deleteRecursively() }
}
