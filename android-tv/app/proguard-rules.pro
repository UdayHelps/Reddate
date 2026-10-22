# The page in the hidden WebView (the engine) calls these by name through window.ReddateNative.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
# Stack traces in bug reports stay readable.
-keepattributes SourceFile,LineNumberTable
