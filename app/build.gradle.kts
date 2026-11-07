plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val runNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "se.ludvig.thewindow"
    compileSdk = 35

    defaultConfig {
        applicationId = "se.ludvig.thewindow"
        minSdk = 24
        targetSdk = 35
        versionCode = runNumber
        versionName = "0.1.$runNumber"
    }

    // Samma nyckel i varje bygge, så att nya APK:er kan installeras ovanpå
    // den gamla utan att världen (appens data) raderas.
    signingConfigs {
        create("shared") {
            storeFile = file("thewindow.keystore")
            storePassword = "thewindow"
            keyAlias = "thewindow"
            keyPassword = "thewindow"
        }
    }

    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("shared") }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
