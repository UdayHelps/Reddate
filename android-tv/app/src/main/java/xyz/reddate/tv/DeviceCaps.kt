package xyz.reddate.tv

import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList

/** What this TV's video decoders can do, so Play picks a stream it can actually show. */
object DeviceCaps {
    private val decoders by lazy { try { MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder } } catch (_: Exception) { emptyList() } }
    private fun forMime(mime: String) = decoders.filter { info -> info.supportedTypes.any { it.equals(mime, true) } }

    val hevc: Boolean by lazy { forMime("video/hevc").isNotEmpty() }
    val hevc10: Boolean by lazy {
        forMime("video/hevc").any { c ->
            // Ask with the decoder's own spelling of the type; some TVs throw for any other.
            val type = c.supportedTypes.firstOrNull { it.equals("video/hevc", true) } ?: return@any false
            try { c.getCapabilitiesForType(type).profileLevels.any { it.profile == CodecProfileLevel.HEVCProfileMain10 || it.profile == CodecProfileLevel.HEVCProfileMain10HDR10 } } catch (_: Exception) { false }
        }
    }
    val dolbyVision: Boolean by lazy { forMime("video/dolby-vision").isNotEmpty() }
    val av1: Boolean by lazy { forMime("video/av01").isNotEmpty() }
    /** Tallest picture the decoders handle (1080 on most TVs, 2160 on 4K ones). */
    val maxHeight: Int by lazy {
        (forMime("video/avc") + forMime("video/hevc")).maxOfOrNull { c ->
            try {
                val t = c.supportedTypes.first { it.equals("video/avc", true) || it.equals("video/hevc", true) }
                c.getCapabilitiesForType(t).videoCapabilities.supportedHeights.upper
            } catch (_: Exception) { 1080 }
        } ?: 1080
    }

    data class Fit(val ok: Boolean, val height: Int, val reason: String)

    /** Can this TV likely play a stream with this name? Read from the usual release-name tags. */
    // Compiled once: a few hundred links are checked many times as the list updates.
    private val reUhd = Regex("2160p|\\b4k\\b|\\buhd\\b")
    private val reSd = Regex("480p|576p|\\bsd\\b")
    private val reHevc = Regex("hevc|x265|h\\.?265")
    private val reTenBit = Regex("10.?bit|hdr10|\\bhdr\\b|main.?10")
    private val reDv = Regex("\\bdv\\b|dolby.?vision|\\bdovi\\b")
    private val reHdr = Regex("hdr10|\\bhdr\\b")
    private val reAv1 = Regex("\\bav1\\b")
    private val fitCache = java.util.concurrent.ConcurrentHashMap<String, Fit>()

    fun fit(text: String): Fit = fitCache.getOrPut(text) { computeFit(text) }.also { if (fitCache.size > 4000) fitCache.clear() }

    private fun computeFit(text: String): Fit {
        val t = text.lowercase()
        val h = when {
            reUhd.containsMatchIn(t) -> 2160
            "1440p" in t -> 1440
            "1080p" in t -> 1080
            "720p" in t -> 720
            reSd.containsMatchIn(t) -> 480
            else -> 0
        }
        val isHevc = reHevc.containsMatchIn(t)
        val tenBit = reTenBit.containsMatchIn(t)
        val dvOnly = reDv.containsMatchIn(t) && !reHdr.containsMatchIn(t)
        val isAv1 = reAv1.containsMatchIn(t)
        return when {
            h > maxHeight -> Fit(false, h, "${h}p is more than this TV can show")
            isAv1 && !av1 -> Fit(false, h, "AV1 isn't supported on this TV")
            dvOnly && !dolbyVision -> Fit(false, h, "Dolby Vision isn't supported on this TV")
            isHevc && !hevc -> Fit(false, h, "HEVC isn't supported on this TV")
            isHevc && tenBit && !hevc10 -> Fit(false, h, "10-bit HEVC isn't supported on this TV")
            else -> Fit(true, h, "")
        }
    }
}
