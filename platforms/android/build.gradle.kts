// Kotlin DSL fragment for an app module that hosts the widget.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.widgets.servermonitor"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.widgets.servermonitor"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    // Serve the widget bundle from assets over https://appassets.androidplatform.net
    sourceSets["main"].assets.srcDirs("src/main/assets", "web")

    buildFeatures { viewBinding = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.constraintlayout:constraintlayout:2.2.0")
    implementation("androidx.webkit:webkit:1.12.1") // WebViewAssetLoader
}

// Copy the built widget bundle into the module's web assets:
//   ./gradlew copyWidgetBundle
tasks.register<Copy>("copyWidgetBundle") {
    from(rootProject.file("../packages/server-monitor/dist"))
    into(layout.projectDirectory.dir("web"))
    include("server-monitor.global.js", "server-monitor.global.js.map")
}
