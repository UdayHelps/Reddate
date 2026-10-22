package xyz.reddate.tv

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * The bridge to the Reddate page running underneath the native screens. The page is the "engine":
 * it holds the room connection, sync, chat and the account. Native screens ask it things with
 * [call] and hear about changes through [events].
 */
object Engine {
    @Volatile var web: WebView? = null
    private val main = Handler(Looper.getMainLooper())
    private val nextId = AtomicInteger(1)
    private val pending = ConcurrentHashMap<Int, CompletableDeferred<String>>()

    private val _events = MutableSharedFlow<JSONObject>(extraBufferCapacity = 32)
    val events: SharedFlow<JSONObject> = _events

    class EngineError(message: String) : Exception(message)

    /** Ask the page: returns the decoded result (JSONObject, JSONArray, String, Number, Boolean or null). */
    suspend fun call(method: String, args: JSONObject? = null, timeoutMs: Long = 30_000): Any? {
        val id = nextId.getAndIncrement()
        val done = CompletableDeferred<String>()
        pending[id] = done
        val argJson = JSONObject.quote(args?.toString() ?: "{}")
        main.post {
            web?.evaluateJavascript("window.ReddateTV&&window.ReddateTV.rpc&&window.ReddateTV.rpc($id,${JSONObject.quote(method)},$argJson)", null)
        }
        try {
            val raw = withTimeout(timeoutMs) { done.await() }
            val o = JSONObject(raw)
            if (!o.optBoolean("ok")) throw EngineError(o.optString("error", "Something went wrong"))
            return if (o.isNull("r")) null else o.get("r")
        } finally {
            pending.remove(id)
        }
    }

    fun onReply(id: Int, json: String) { pending[id]?.complete(json) }

    fun onEvent(json: String) {
        try { _events.tryEmit(JSONObject(json)) } catch (_: Exception) { /* malformed: ignore */ }
    }

    /** Plain GET of a JSON document (catalog rows come straight from the catalog addon). */
    suspend fun getJson(url: String): Any? = withContext(Dispatchers.IO) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 12_000
        c.readTimeout = 20_000
        c.setRequestProperty("Accept", "application/json")
        try {
            if (c.responseCode !in 200..299) throw EngineError("HTTP ${c.responseCode}")
            val text = c.inputStream.bufferedReader().use { it.readText() }
            JSONTokener(text).nextValue()
        } finally { c.disconnect() }
    }
}

// Small helpers for reading the page's JSON.
fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key, "")
