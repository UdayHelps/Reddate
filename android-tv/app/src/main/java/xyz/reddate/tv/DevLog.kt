package xyz.reddate.tv

import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Development aid: while testing against a computer on the local network (the start URL is a private
 * address), send what the app is doing to a small collector on that computer. Does nothing for the real
 * site (https://reddate.xyz), so release builds never send anything.
 */
object DevLog {
    private val host: String? by lazy {
        val h = try { Uri.parse(BuildConfig.START_URL).host } catch (e: Exception) { null }
        if (h != null && Regex("^(192\\.168\\.|10\\.|172\\.(1[6-9]|2\\d|3[01])\\.)").containsMatchIn(h)) h else null
    }

    fun log(kind: String, data: String) {
        val h = host ?: return
        Thread {
            try {
                val c = URL("http://$h:3091/log").openConnection() as HttpURLConnection
                c.requestMethod = "POST"
                c.doOutput = true
                c.connectTimeout = 1500
                c.readTimeout = 1500
                val body = JSONObject().put("kind", "native-app:$kind").put("data", data).put("t", System.currentTimeMillis())
                c.outputStream.use { it.write(body.toString().toByteArray()) }
                c.responseCode
                c.disconnect()
            } catch (_: Exception) { /* a dev aid must never get in the way */ }
        }.start()
    }
}
