package xyz.reddate.tv

import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Finds how far a subtitle file is off from the speech: slides the "is someone talking" pattern of the
 * subtitles over the loudness of the sound and keeps the shift where they agree best.
 */
object SubSync {
    data class Result(val delayMs: Long, val confidence: Float, val reason: String = "")

    /**
     * [loud] is the loudness per [binMs], starting at [startMs] in the video; [cues] are the subtitle
     * lines. Returns the delay to add to the subtitles (positive = show them later), or a reason it
     * couldn't tell.
     */
    fun solve(loud: FloatArray, startMs: Long, binMs: Long, cues: List<SubtitleEngine.Cue>, maxShiftMs: Long = 20_000): Result {
        val n = loud.size
        if (n < 200) return Result(0, 0f, "Not enough sound heard yet.")
        // 1. loudness -> "someone is probably speaking", 0..1, relative to this scene
        val logs = FloatArray(n) { ln(1.0 + loud[it]).toFloat() }
        val sorted = logs.sortedArray()
        val lo = sorted[(n * 0.30).toInt()]
        val hi = sorted[(n * 0.90).toInt()]
        if (hi - lo < 0.2f) return Result(0, 0f, "The sound is too even to tell speech from silence.")
        val speech = FloatArray(n) { ((logs[it] - lo) / (hi - lo)).coerceIn(0f, 1f) }
        // 2. the subtitles as the same kind of signal, over a wider stretch so shifts have something to land on
        val shiftBins = (maxShiftMs / binMs).toInt()
        val total = n + 2 * shiftBins
        val base = startMs - shiftBins * binMs
        val talk = FloatArray(total)
        var inWindow = 0
        for (c in cues) {
            val a = ((c.start - base) / binMs).toInt().coerceAtLeast(0)
            val b = ((c.end - base) / binMs).toInt().coerceAtMost(total - 1)
            if (b >= a) for (i in a..b) talk[i] = 1f
            if (c.end > startMs && c.start < startMs + n * binMs) inWindow++
        }
        if (inWindow < 5) return Result(0, 0f, "Too few subtitle lines in this stretch.")
        // 3. correlation for every shift (centered, so busy and quiet stretches don't favour any shift)
        val meanS = speech.average().toFloat()
        var varS = 0.0
        for (v in speech) varS += (v - meanS) * (v - meanS)
        val scores = FloatArray(2 * shiftBins + 1)
        for (k in scores.indices) {
            // speech at bin i matches a cue that was at bin i + (k - shiftBins) in the file, so the file is
            // that many bins early/late: delay = (k - shiftBins) * binMs ... measured below
            val shift = k - shiftBins          // subtitles are moved later by `shift` bins
            var sum = 0.0; var sumT = 0.0; var sumT2 = 0.0; var cross = 0.0
            for (i in 0 until n) {
                val t = talk[i + shiftBins - shift]
                sum += t
                sumT += t; sumT2 += t * t
                cross += (speech[i] - meanS) * t
            }
            val meanT = sumT / n
            val varT = sumT2 - n * meanT * meanT
            scores[k] = if (varT > 1e-6 && varS > 1e-6) (cross / sqrt(varT * varS)).toFloat() else 0f
        }
        var best = 0
        for (k in scores.indices) if (scores[k] > scores[best]) best = k
        // 4. is the peak clearly better than the rest (away from its own neighbourhood)?
        var sumAll = 0.0; var cnt = 0; var sq = 0.0
        val near = 15 // 1.5 s around the peak belongs to the peak
        for (k in scores.indices) if (abs(k - best) > near) { sumAll += scores[k]; sq += scores[k] * scores[k]; cnt++ }
        val mean = (sumAll / max(cnt, 1)).toFloat()
        val sd = sqrt(max(sq / max(cnt, 1) - mean * mean, 1e-9)).toFloat()
        val z = (scores[best] - mean) / sd
        val delay = (best - shiftBins) * binMs
        return when {
            scores[best] < 0.10f -> Result(delay, z, "The speech and the subtitles don't line up clearly.")
            z < 4.0f -> Result(delay, z, "Not sure enough. Try again in a talkative scene.")
            else -> Result(delay, z)
        }
    }
}
