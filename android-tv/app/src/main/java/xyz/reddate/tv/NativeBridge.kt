package xyz.reddate.tv

import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * What the Reddate web page can ask of the TV. It's exposed to the page as
 * `window.ReddateNative`, which is also how the page knows it is running inside the TV app.
 * Methods run on a background thread, so anything touching the UI hops to the main thread.
 */
class NativeBridge(private val activity: MainActivity) {

    /** Shown in the user's device list ("Living Room TV"). */
    @JavascriptInterface
    fun deviceName(): String {
        val model = Build.MODEL?.trim().orEmpty()
        return if (model.isEmpty()) "Android TV" else model.take(40)
    }

    /** The page has nothing left to go back to: close the app. */
    @JavascriptInterface
    fun exit() {
        activity.runOnUiThread { activity.finish() }
    }

    /** True when this app has a native player (the page then uses it instead of the browser's own). */
    @JavascriptInterface
    fun hasPlayer(): Boolean = true

    /** True: the app draws Home, title pages and the rest natively; the page is the engine underneath. */
    @JavascriptInterface
    fun hasNativeUi(): Boolean = true

    /** The page's answer to an Engine.call(). */
    @JavascriptInterface
    fun reply(id: Int, json: String) = Engine.onReply(id, json)

    /** Something the native screens should know about (surface changes, account, Home rows changed…). */
    @JavascriptInterface
    fun event(json: String) = Engine.onEvent(json)

    /** Open the native player: {"url", "title", "startMs", "playWhenReady"}. Only http(s) links. */
    @JavascriptInterface
    fun open(json: String) {
        val o = try { JSONObject(json) } catch (e: Exception) { return }
        val url = o.optString("url")
        if (!url.startsWith("https://") && !url.startsWith("http://")) return
        activity.runOnUiThread {
            val i = Intent(activity, PlayerActivity::class.java)
                .putExtra("url", url)
                .putExtra("sid", o.optString("sid"))
                .putExtra("art", o.optString("art"))
                .putExtra("title", o.optString("title"))
                .putExtra("startMs", o.optLong("startMs", 0L))
                .putExtra("playWhenReady", o.optBoolean("playWhenReady", false))
                .putExtra("subPref", o.optString("subPref"))
                .putExtra("chatOn", o.optBoolean("chatOn", true))
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            activity.startActivity(i)
        }
    }

    /** A room command for the open player: {"cmd":"play"|"pause"|"seek"|"stop"|"info","ms":…,"info":{…}}. */
    @JavascriptInterface
    fun command(json: String) {
        val o = try { JSONObject(json) } catch (e: Exception) { return }
        activity.runOnUiThread { PlayerActivity.current?.handle(o) }
    }
}
