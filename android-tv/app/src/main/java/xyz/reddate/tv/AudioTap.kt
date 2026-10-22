package xyz.reddate.tv

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.abs

/**
 * Listens to the sound that is being played (passes it through untouched) and keeps how loud each
 * tenth of a second was, so subtitles can be lined up with the speech. Only 16-bit sound is read;
 * other formats (Dolby passthrough, say) are left alone and simply can't be analysed.
 */
@UnstableApi
class AudioTap : BaseAudioProcessor() {
    @Volatile private var recording = false
    @Volatile var supported = false
        private set
    private var rate = 48_000
    private var channels = 2
    private var binFrames = 4_800
    private var frameInBin = 0
    private var sumAbsDiff = 0.0
    private var last = 0
    private val bins = ArrayList<Float>()
    @Volatile var startMs = -1L
        private set
    private var pos0 = 0L
    private var t0 = 0L
    /** How far ahead of what you hear the sound is when we see it (the speaker's buffer). */
    var leadMs = 0L

    val binMs = 100L
    val count get() = synchronized(bins) { bins.size }

    /** Start collecting; [positionMs] is where the player is right now (read on the main thread by the caller). */
    fun begin(positionMs: Long) {
        synchronized(bins) { bins.clear() }
        frameInBin = 0; sumAbsDiff = 0.0; last = 0
        startMs = -1L
        pos0 = positionMs
        t0 = android.os.SystemClock.elapsedRealtime()
        recording = true
    }

    fun stop(): FloatArray {
        recording = false
        return synchronized(bins) { bins.toFloatArray() }
    }

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) { supported = false; return AudioProcessor.AudioFormat.NOT_SET }
        supported = true
        rate = inputAudioFormat.sampleRate
        channels = inputAudioFormat.channelCount.coerceAtLeast(1)
        binFrames = (rate * binMs / 1000).toInt().coerceAtLeast(1)
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) return
        if (recording) analyse(inputBuffer.duplicate())
        val out = replaceOutputBuffer(size)
        out.put(inputBuffer)
        out.flip()
    }

    private fun analyse(b: ByteBuffer) {
        if (startMs < 0) startMs = pos0 + (android.os.SystemClock.elapsedRealtime() - t0) + leadMs
        b.order(java.nio.ByteOrder.LITTLE_ENDIAN)
        while (b.remaining() >= 2 * channels) {
            // one mono sample: the average of the channels
            var s = 0
            for (c in 0 until channels) s += b.short.toInt()
            s /= channels
            // the change from the last sample: rumble and hum drop out, speech and hiss stay
            sumAbsDiff += abs(s - last)
            last = s
            if (++frameInBin >= binFrames) {
                synchronized(bins) { bins.add((sumAbsDiff / binFrames).toFloat()) }
                frameInBin = 0; sumAbsDiff = 0.0
            }
        }
    }
}
