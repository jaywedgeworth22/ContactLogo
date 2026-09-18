plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.contactlogo"
    // Google Play has required targetSdk 35 for new and updated app submissions
    // since August 2025 (CL-24); targetSdk stays at 35. compileSdk is bumped to
    // 37 because Compose BOM 2026.08.00's artifacts require compiling against
    // API 37 or later (androidx.compose.* 1.12.0) -- this is a compile-time-only
    // change and does not affect targetSdk/minSdk runtime behavior.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.contactlogo"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.0.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        // Compile-time DSN only.  Empty when SENTRY_DSN is unset so the SDK stays dark in CI.
        val sentryDsn = (System.getenv("SENTRY_DSN") ?: "")
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
        buildConfigField("String", "SENTRY_DSN", "\"$sentryDsn\"")
    }

    buildTypes {
        release {
            // R8 was shipping disabled for release builds (CL-24); enabled with
            // the project's own proguard-rules.pro (previously referenced but
            // absent, so this block silently did nothing).
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // jvmTarget defaults to compileOptions.targetCompatibility under built-in
    // Kotlin (AGP 9+), so no separate kotlinOptions/kotlin.compilerOptions
    // block is needed here.
    buildFeatures {
        compose = true
        buildConfig = true
    }
    // Compose compiler version now tracks the org.jetbrains.kotlin.plugin.compose
    // plugin version above; kotlinCompilerExtensionVersion is obsolete post-Kotlin 2.0.
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

// A CI log that says only "see the HTML report" cannot be diagnosed from a CI
// log.  Print the failing test, its assertion, and the stack.
tasks.withType<Test>().configureEach {
    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        showExceptions = true
        showCauses = true
        showStackTraces = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation(platform("androidx.compose:compose-bom:2026.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("io.coil-kt:coil-compose:2.6.0")
    implementation("io.coil-kt:coil-svg:2.6.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.google.android.play:app-update:2.1.0")
    // Crash + ANR only.  Mapping upload plugin skipped (AGP 8.5); consumer rules ship with the AAR.
    implementation("io.sentry:sentry-android:8.54.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
}
