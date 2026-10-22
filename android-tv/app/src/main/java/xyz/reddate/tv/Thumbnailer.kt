package xyz.reddate.tv

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.os.Build
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Preview frames for scrubbing: pulls a small picture out of the stream itself (there is no pre-made
 * sheet of thumbnails for addon streams), one at a time on its own thread and its own connection so
 * it never competes with playback for the player. Frames are remembered in 5 second steps.
 */
class Thumbnailer(private val url: String) {
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "thumbs").apply { isDaemon = true } }
    private val cache = ConcurrentHashMap<Long, Bitmap>()
    private val pending = ConcurrentHashMap.newKeySet<Long>()
    @Volatile private var retriever: MediaMetadataRetriever? = null
    @Volatile private var source: RangeSource? = null
    @Volatile private var broken = 0
    @Volatile private var closed = false
    @Volatile private var direct = false // our own ranged reader first; the platform's HTTP reader if that can't
    @Volatile private var lastError = ""
    @Volatile private var reported = false
    @Volatile var wanted = -1L // the step the viewer is looking at now; older queued ones are skipped

    /** True once this stream has shown it can't give us pictures (only the time is shown then). */
    val failed: Boolean get() = broken >= 4

    private fun key(ms: Long) = ms / STEP_MS

    /** The frame for this time if we already have it (or the nearest one we do have within a minute). */
    fun peek(ms: Long): Bitmap? {
        val k = key(ms)
        cache[k]?.let { return it }
        for (d in 1..12) { cache[k - d]?.let { return it }; cache[k + d]?.let { return it } }
        return null
    }

    fun has(ms: Long) = cache.containsKey(key(ms))

    /** Ask for the frame at [ms]; [onReady] runs on the thumbnail thread when it arrives. */
    fun request(ms: Long, priority: Boolean, fill: Boolean = false, onReady: (Long) -> Unit) {
        val k = key(ms)
        if (broken >= 4 && !reported) { reported = true; report() }
        if (closed || broken >= 4 || cache.containsKey(k) || !pending.add(k)) return
        if (priority) wanted = k
        io.execute {
            try {
                if (closed) return@execute
                // A newer request replaced this one while it waited: don't spend a fetch on it.
                if (!priority && !fill && wanted >= 0 && Math.abs(k - wanted) > 8) return@execute
                val t0 = System.currentTimeMillis()
                val r = retriever ?: MediaMetadataRetriever().also {
                    DevLog.log("thumb", "opening")
                    if (direct) it.setDataSource(url, HashMap<String, String>()) else it.setDataSource(RangeSource(url).also { src -> source = src })
                    retriever = it
                }
                val us = k * STEP_MS * 1000
                val bmp = if (Build.VERSION.SDK_INT >= 30) r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, W, H, MediaMetadataRetriever.BitmapParams().apply { preferredConfig = Bitmap.Config.RGB_565 })
                else if (Build.VERSION.SDK_INT >= 27) r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, W, H)
                else r.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { Bitmap.createScaledBitmap(it, W, H, true) }
                DevLog.log("thumb", "frame ${k * STEP_MS}ms in ${System.currentTimeMillis() - t0} ms ok=${bmp != null}" + (source?.let { " · reads ${it.reads} fetches ${it.fetches} ${it.bytes / 1024} KB net ${it.netMs} ms" } ?: ""))
                if (bmp != null) { cache[k] = bmp; broken = 0; onReady(k * STEP_MS) } else { DevLog.log("thumb", "null frame at ${k * STEP_MS}"); broken++ }
            } catch (e: Throwable) {
                DevLog.log("thumb", "fail ${e.javaClass.simpleName}: ${e.message?.take(80)}")
                try { retriever?.release() } catch (_: Throwable) { }
                retriever = null
                if (!direct) { // first failure: this host may not do byte ranges; try the platform reader before giving up
                    direct = true
                    pending.remove(k)
                    request(ms, priority, fill, onReady)
                    return@execute
                }
                broken++
                lastError = "${e.javaClass.simpleName}: ${e.message?.take(100)}"
                // A stream that can't be read this way just shows the time; give up quietly.
                try { retriever?.release() } catch (_: Throwable) { }
                retriever = null
            } finally { pending.remove(k) }
        }
    }

    /** Tell the server log, once, that previews couldn't be made for a stream (the error and the host only). */
    private fun report() {
        val host = try { java.net.URI(url).host ?: "?" } catch (_: Exception) { "?" }
        val text = "thumbnails failed · host $host · $lastError · Android ${android.os.Build.VERSION.RELEASE} · ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"
        Thread {
            try {
                val u = android.net.Uri.parse(BuildConfig.START_URL)
                val c = URL("${u.scheme}://${u.authority}/api/crash").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 6000; c.readTimeout = 6000
                c.setRequestProperty("Content-Type", "text/plain; charset=utf-8")
                c.outputStream.use { it.write(text.toByteArray()) }
                c.responseCode; c.disconnect()
            } catch (_: Exception) { }
        }.start()
    }

    // ---- filling the whole timeline in the background, so a picture is ready wherever you scrub ----
    @Volatile var hold = false        // the video is buffering: leave the connection to it
    @Volatile var playheadMs = 0L     // where the video is, to fill outwards from there
    @Volatile private var fillDur = 0L
    private var gridSteps = 12L       // every minute first, then every 30 s
    private val timer = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "thumbs-fill").apply { isDaemon = true } }

    fun startFill(durMs: Long) {
        if (fillDur > 0 || durMs <= 0) return
        fillDur = durMs
        timer.schedule({ fillTick() }, 400, java.util.concurrent.TimeUnit.MILLISECONDS)
    }

    private fun fillTick() {
        if (closed || failed) return
        if (hold || pending.isNotEmpty()) { timer.schedule({ fillTick() }, 1500, java.util.concurrent.TimeUnit.MILLISECONDS); return }
        val last = (fillDur - 1000) / STEP_MS
        val here = key(playheadMs)
        var next: Long? = null
        while (next == null) {
            next = (0L..last step gridSteps).filter { !cache.containsKey(it) }.minByOrNull { Math.abs(it - here) }
            if (next == null) { if (gridSteps == 12L) gridSteps = 6L else return } // all filled
        }
        request(next * STEP_MS, false, fill = true) { }
        timer.schedule({ fillTick() }, 700, java.util.concurrent.TimeUnit.MILLISECONDS)
    }

    fun close() {
        closed = true
        timer.shutdownNow()
        io.execute { try { retriever?.release() } catch (_: Throwable) { }; retriever = null; cache.clear() }
        io.shutdown()
    }

    companion object {
        const val STEP_MS = 5_000L
        const val W = 288
        const val H = 162
    }
}
