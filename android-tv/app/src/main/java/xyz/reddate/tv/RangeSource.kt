package xyz.reddate.tv

import android.media.MediaDataSource
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Lets the frame grabber read a stream through plain ranged requests we control (redirects between
 * http and https, a user agent, timeouts) instead of the platform's own HTTP reader, which is fussy
 * about the links streaming addons hand out. Blocks are kept briefly so nearby reads are cheap.
 */
class RangeSource(private val startUrl: String) : MediaDataSource() {
    private var finalUrl: String? = null
    private var total = -1L
    @Volatile var fetches = 0; @Volatile var bytes = 0L; @Volatile var netMs = 0L; @Volatile var reads = 0
    private val blockSize = 512 * 1024
    private val cache = object : LinkedHashMap<Long, ByteArray>(16, 0.75f, true) {
        override fun removeEldestEntry(e: MutableMap.MutableEntry<Long, ByteArray>?) = size > 48
    }

    private fun open(from: Long, to: Long): HttpURLConnection {
        var u = finalUrl ?: startUrl
        for (hop in 0 until 6) {
            val c = URL(u).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 8_000
            c.readTimeout = 15_000
            c.setRequestProperty("Range", "bytes=$from-$to")
            c.setRequestProperty("User-Agent", "ReddateTV")
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location") ?: throw IOException("redirect without a place")
                c.disconnect()
                u = URL(URL(u), loc).toString() // relative or absolute, http or https
                finalUrl = u
                continue
            }
            if (code != 206 && code != 200) { c.disconnect(); throw IOException("HTTP $code") }
            if (code == 200 && from > 0) { c.disconnect(); throw IOException("no ranges") }
            finalUrl = u
            c.getHeaderField("Content-Range")?.substringAfter('/')?.toLongOrNull()?.let { total = it }
            if (total < 0 && code == 200) c.contentLengthLong.takeIf { it > 0 }?.let { total = it }
            return c
        }
        throw IOException("too many redirects")
    }

    private val ahead = java.util.concurrent.Executors.newFixedThreadPool(3) { r -> Thread(r, "thumbs-ahead").apply { isDaemon = true } }
    private val inFlight = java.util.concurrent.ConcurrentHashMap.newKeySet<Long>()
    private var lastIndex = -10L

    /** Reading in order (which is how a container gets scanned): fetch the next blocks in parallel. */
    private fun readAhead(index: Long) {
        if (index != lastIndex + 1) { lastIndex = index; return }
        lastIndex = index
        for (n in index + 1..index + 3) {
            if (total in 0..(n * blockSize)) break
            if (synchronized(cache) { cache.containsKey(n) } || !inFlight.add(n)) continue
            ahead.execute { try { block(n) } catch (_: Exception) { } finally { inFlight.remove(n) } }
        }
    }

    private fun block(index: Long): ByteArray? {
        synchronized(cache) { cache[index]?.let { return it } }
        val from = index * blockSize
        if (total in 0..from) return null
        val to = if (total > 0) minOf(from + blockSize - 1, total - 1) else from + blockSize - 1
        val t0 = System.currentTimeMillis()
        val c = open(from, to)
        val data = try { c.inputStream.use { it.readBytes() } } finally { c.disconnect() }
        fetches++; bytes += data.size; netMs += System.currentTimeMillis() - t0
        synchronized(cache) { cache[index] = data }
        return data
    }

    override fun getSize(): Long {
        if (total < 0) block(0)
        return total
    }

    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (size == 0) return 0
        reads++
        var read = 0
        var pos = position
        while (read < size) {
            val idx = pos / blockSize
            val b = block(idx) ?: break
            readAhead(idx)
            val inBlock = (pos - idx * blockSize).toInt()
            if (inBlock >= b.size) break
            val n = minOf(size - read, b.size - inBlock)
            System.arraycopy(b, inBlock, buffer, offset + read, n)
            read += n; pos += n
        }
        return if (read == 0) -1 else read
    }

    override fun close() { ahead.shutdownNow(); synchronized(cache) { cache.clear() } }
}
