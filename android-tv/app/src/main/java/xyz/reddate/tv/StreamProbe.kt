package xyz.reddate.tv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * How well a stream will play on this TV's connection: time to the first byte (ms) and real
 * download speed, measured by fetching the start of the file (512 KB at most). Compared with the
 * stream's bitrate that gives green (plenty of headroom), yellow (just enough) or red (will buffer).
 */
object StreamProbe {
    /** PINGED: only the reply time is known yet (the speed test comes next). */
    enum class Grade { GOOD, OK, BAD, FAILED, PINGED }
    data class Result(val ms: Int, val mbps: Double, val grade: Grade)

    private const val SAMPLE_BYTES = 256 * 1024
    private val cache = ConcurrentHashMap<String, Pair<Long, Result>>()
    private const val TTL_MS = 10 * 60 * 1000L

    fun cached(url: String): Result? = cache[url]?.takeIf { System.currentTimeMillis() - it.first < TTL_MS }?.second

    /**
     * The quick check: how fast each stream answers (time to the first byte), all at once, 3 seconds at most. Hundreds of bytes
     * only, so a whole list is ranked in about a second instead of waiting for the speed tests.
     */
    suspend fun pingAll(urls: List<String>, onEach: (String, Result) -> Unit) = coroutineScope {
        val gate = Semaphore(20)
        urls.map { url ->
            async {
                cached(url)?.let { onEach(url, it); return@async }
                gate.withPermit {
                    val r = withTimeoutOrNull(3_000) { ping(url) } ?: Result(0, 0.0, Grade.FAILED)
                    // Only a failure or a real speed test is remembered for ten minutes; a ping is cheap to repeat.
                    if (r.grade == Grade.FAILED) cache[url] = System.currentTimeMillis() to r
                    onEach(url, r)
                }
            }
        }.awaitAll()
    }

    private suspend fun ping(url: String): Result = withContext(Dispatchers.IO) {
        var c: HttpURLConnection? = null
        try {
            val t0 = System.nanoTime()
            c = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 2_500
                readTimeout = 2_500
                instanceFollowRedirects = true
                setRequestProperty("Range", "bytes=0-1023")
                setRequestProperty("User-Agent", "ReddateTV")
            }
            val code = c.responseCode
            if (code !in 200..299) return@withContext Result(0, 0.0, Grade.FAILED)
            Result(((System.nanoTime() - t0) / 1_000_000).toInt(), 0.0, Grade.PINGED)
        } catch (_: Exception) {
            Result(0, 0.0, Grade.FAILED)
        } finally {
            c?.disconnect() // no body is read: the connection is dropped right after the first bytes
        }
    }

    /** Probe several streams, a few at a time; [onEach] is called as each one finishes. */
    suspend fun probeAll(items: List<Pair<String, Double>>, sampleBytes: Int = SAMPLE_BYTES, onEach: (String, Result) -> Unit) = coroutineScope {
        val gate = Semaphore(6)
        items.map { (url, bitrate) ->
            async {
                cached(url)?.let { onEach(url, it); return@async }
                gate.withPermit {
                    val r = withTimeoutOrNull(7_000) { probe(url, bitrate, sampleBytes) } ?: Result(0, 0.0, Grade.FAILED)
                    cache[url] = System.currentTimeMillis() to r
                    onEach(url, r)
                }
            }
        }.awaitAll()
    }

    private suspend fun probe(url: String, bitrateMbps: Double, sample: Int): Result = withContext(Dispatchers.IO) {
        var c: HttpURLConnection? = null
        try {
            val t0 = System.nanoTime()
            c = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 5_000
                readTimeout = 5_000
                instanceFollowRedirects = true
                setRequestProperty("Range", "bytes=0-${sample - 1}")
                setRequestProperty("User-Agent", "ReddateTV")
            }
            val code = c.responseCode
            if (code !in 200..299) return@withContext Result(0, 0.0, Grade.FAILED)
            val ttfb = ((System.nanoTime() - t0) / 1_000_000).toInt()
            val buf = ByteArray(64 * 1024)
            var total = 0
            val tRead = System.nanoTime()
            c.inputStream.use { input ->
                while (total < sample) {
                    val n = input.read(buf)
                    if (n < 0) break
                    total += n
                    if (System.nanoTime() - tRead > 3_500_000_000L) break // enough to judge
                }
            }
            val secs = ((System.nanoTime() - tRead) / 1e9).coerceAtLeast(0.05)
            val mbps = total * 8 / 1_000_000.0 / secs
            val need = if (bitrateMbps > 0) bitrateMbps else 8.0 // unknown bitrate: assume a typical 1080p file
            val grade = when {
                total < minOf(32 * 1024, sample) -> Grade.FAILED
                mbps >= need * 1.6 && ttfb < 1500 -> Grade.GOOD
                mbps >= need * 1.0 -> Grade.OK
                else -> Grade.BAD
            }
            Result(ttfb, mbps, grade)
        } catch (_: Exception) {
            Result(0, 0.0, Grade.FAILED)
        } finally {
            c?.disconnect()
        }
    }
}
