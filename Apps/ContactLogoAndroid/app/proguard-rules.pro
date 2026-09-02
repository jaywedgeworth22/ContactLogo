# ContactLogo release R8 rules (CL-24).
#
# build.gradle.kts referenced this file before it existed, so isMinifyEnabled
# had nothing real to run against. Kept intentionally small: Compose, Coil and
# kotlinx.coroutines all ship their own consumer ProGuard/R8 rules inside their
# AARs and merge automatically, so this file only needs project-specific rules.
#
# Uncomment and add project-specific -keep rules here if a release build strips
# something this app needs (e.g. a class only referenced via reflection).

# The engine's contact/candidate/result models are plain data classes read and
# written only from Kotlin code in this module (no reflection, no
# serialization library) - nothing extra to keep for them today.

# Keep line numbers in stack traces for crash reports; drop the source file
# name to avoid also leaking it into obfuscated traces.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Sentry ships consumer ProGuard rules in the AAR.  No extra -keep needed.
