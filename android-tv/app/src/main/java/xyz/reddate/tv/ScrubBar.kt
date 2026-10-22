package xyz.reddate.tv

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

/**
 * The timeline: a thin track with what's buffered and what's played, and a round handle that grows
 * when the bar is selected (instead of a big grey box around the whole row).
 */
class ScrubBar(context: Context, private val accent: Int) : View(context) {
    var progress = 0          // 0..1000
        set(v) { field = v.coerceIn(0, 1000); invalidate() }
    var secondaryProgress = 0 // buffered, 0..1000
        set(v) { field = v.coerceIn(0, 1000); invalidate() }
    private var grow = 0f     // 0 = resting, 1 = selected
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    private val d = resources.displayMetrics.density
    private var anim: ValueAnimator? = null

    fun setSelectedLook(on: Boolean) {
        anim?.cancel()
        anim = ValueAnimator.ofFloat(grow, if (on) 1f else 0f).apply {
            duration = 160
            addUpdateListener { grow = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        val cy = height / 2f
        val half = (2f + 3f * grow) * d                 // the track thickens a little when selected
        val handle = (5f + 8f * grow) * d               // and the handle grows
        val pad = handle
        val x0 = pad; val x1 = w - pad
        paint.style = Paint.Style.FILL
        paint.color = 0x55FFFFFF
        rect.set(x0, cy - half, x1, cy + half)
        c.drawRoundRect(rect, half, half, paint)
        paint.color = 0x88FFFFFF.toInt()
        rect.set(x0, cy - half, x0 + (x1 - x0) * secondaryProgress / 1000f, cy + half)
        c.drawRoundRect(rect, half, half, paint)
        paint.color = accent
        val px = x0 + (x1 - x0) * progress / 1000f
        rect.set(x0, cy - half, px, cy + half)
        c.drawRoundRect(rect, half, half, paint)
        // the handle: white with a soft ring so it reads on any picture
        if (grow > 0f) { // selected: an orange halo and ring, so it's obvious this is what the remote controls
            paint.color = (accent and 0x00FFFFFF) or ((0x55 * grow).toInt() shl 24)
            c.drawCircle(px, cy, handle + 9f * d * grow, paint)
        }
        paint.color = 0x33000000
        c.drawCircle(px, cy, handle + 2f * d, paint)
        paint.color = 0xFFFFFFFF.toInt()
        c.drawCircle(px, cy, handle, paint)
    }
}
