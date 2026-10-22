package xyz.reddate.tv

import android.app.Application
import android.graphics.Bitmap
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.CachePolicy

/** One image loader for the whole app, kept small: TVs often have 1 to 2 GB of RAM shared with the system. */
class ReddateApp : Application(), ImageLoaderFactory {
    companion object { lateinit var instance: ReddateApp private set }

    override fun onCreate() {
        super.onCreate()
        instance = this
        // If the app crashes, keep what went wrong (no personal data: the error and where in the code) and
        // send it to the server next time the app opens, so crashes testers hit can be fixed.
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            try {
                val sw = java.io.StringWriter()
                e.printStackTrace(java.io.PrintWriter(sw))
                val ver = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "?" }
                java.io.File(filesDir, "last-crash.txt").writeText(
                    "app $ver · Android ${android.os.Build.VERSION.RELEASE} · ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} · thread ${t.name}\n" + sw.toString().take(12000)
                )
            } catch (_: Exception) { }
            previous?.uncaughtException(t, e)
        }
    }

    /** Send a crash report saved last time, then forget it. */
    fun sendLastCrash() {
        val f = java.io.File(filesDir, "last-crash.txt")
        if (!f.exists()) return
        Thread {
            try {
                val u = android.net.Uri.parse(BuildConfig.START_URL)
                val c = java.net.URL("${u.scheme}://${u.authority}/api/crash").openConnection() as java.net.HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 8000; c.readTimeout = 8000
                c.setRequestProperty("Content-Type", "text/plain; charset=utf-8")
                c.outputStream.use { it.write(f.readBytes()) }
                if (c.responseCode in 200..299) f.delete()
                c.disconnect()
            } catch (_: Exception) { }
        }.start()
    }

    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .memoryCache { MemoryCache.Builder(this).maxSizePercent(0.12).build() }
        .diskCache { DiskCache.Builder().directory(cacheDir.resolve("img")).maxSizeBytes(80L * 1024 * 1024).build() }
        .bitmapConfig(Bitmap.Config.RGB_565) // half the memory of ARGB_8888; posters don't need transparency
        .allowRgb565(true)
        .crossfade(false)
        .networkCachePolicy(CachePolicy.ENABLED)
        .respectCacheHeaders(false)
        .build()
}
