# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Tauri instancia los plugins de Android por nombre desde Rust (JNI), así que
# R8 no debe eliminarlos ni renombrarlos al compilar en release.
-keep class com.pocketpod.app.MediaSessionPlugin { *; }
-keep class com.pocketpod.app.MediaNotificationListener { *; }
-keep @app.tauri.annotation.TauriPlugin class * { *; }
-keep class * extends app.tauri.plugin.Plugin { *; }
-keepclassmembers class * extends app.tauri.plugin.Plugin {
    @app.tauri.annotation.Command <methods>;
}