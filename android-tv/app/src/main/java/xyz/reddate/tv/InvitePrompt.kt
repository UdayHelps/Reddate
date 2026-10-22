package xyz.reddate.tv

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * "Uday invites you to watch together": a card that pops up on top of whatever is on screen
 * (Home, a page screen, or a playing video). Join goes straight to what they're watching.
 */
class InvitePrompt(private val activity: Activity, private val root: FrameLayout) {
    /** Bricolage Grotesque, extra bold: the app's display face. */
    private fun displayFace(): Typeface {
        val f = androidx.core.content.res.ResourcesCompat.getFont(activity, R.font.bricolage) ?: return Typeface.DEFAULT_BOLD
        return if (android.os.Build.VERSION.SDK_INT >= 28) Typeface.create(f, 800, false) else Typeface.create(f, Typeface.BOLD)
    }
    private val handler = Handler(Looper.getMainLooper())
    private val density = activity.resources.displayMetrics.density
    private fun dp(v: Int) = (v * density).toInt()
    private var card: android.view.View? = null
    private var yesIdx = 0 // which of the two buttons answers yes
    private var answer: ((Boolean) -> Unit)? = null
    val visible get() = card != null
    private var shownAt = 0L
    private var buttonViews: List<TextView> = emptyList()
    private var sel = 0 // 0 = the main (orange) button, 1 = the other

    fun show(from: String, device: String, title: String, onAnswer: (Boolean) -> Unit) {
        val sub = listOf(if (title.isNotEmpty()) "“$title”" else "", if (device.isNotEmpty()) "from $device" else "").filter { it.isNotEmpty() }.joinToString(" ")
        askBig("WATCH PARTY", "${from.ifEmpty { "Someone" }} invites you", if (sub.isEmpty()) "to watch together" else "to watch together · $sub", null, "Join the party", "Not now", selectYes = true, onAnswer = onAnswer)
    }

    /** A yes/no card over whatever is on screen. */
    fun ask(kicker: String, headline: String, sub: String, yes: String, no: String, onAnswer: (Boolean) -> Unit) {
        dismiss()
        answer = onAnswer
        shownAt = android.os.SystemClock.uptimeMillis()
        val c = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(20), dp(24), dp(20))
            background = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(0xF21A1614.toInt()); setStroke(dp(1), 0xFFFF6A32.toInt()) }
            elevation = dp(12).toFloat()
        }
        c.addView(TextView(activity).apply { text = kicker; setTextColor(0xFFFF6A32.toInt()); textSize = 12f; letterSpacing = 0.1f; setTypeface(typeface, Typeface.BOLD) })
        c.addView(TextView(activity).apply { text = headline; setTextColor(Color.WHITE); textSize = 21f; typeface = displayFace(); setPadding(0, dp(4), 0, 0) })
        if (sub.isNotEmpty()) c.addView(TextView(activity).apply { text = sub; setTextColor(0xFFA79E98.toInt()); textSize = 15f; setPadding(0, dp(4), 0, 0) })
        val buttons = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(16), 0, 0) }
        val join = button(yes, primary = true) { finish(true) }
        val other = button(no, primary = false) { finish(false) }
        buttons.addView(join)
        buttons.addView(other)
        buttonViews = listOf(join, other)
        yesIdx = 0
        sel = 0
        c.addView(buttons)
        root.addView(c, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(36) })
        card = c
        c.alpha = 0f
        c.translationY = -dp(20).toFloat()
        c.animate().alpha(1f).translationY(0f).setDuration(220).start()
        join.requestFocus()
        // Nobody answered: let it go quietly.
        handler.postDelayed({ if (card === c) finish(false) }, 45_000)
    }

    /**
     * A large centred question for things that matter ("Stop watching?"): a dimmed screen, a wide card with the
     * title's picture, a big headline, one line of explanation and two big buttons. Left/Right choose, OK confirms,
     * Back keeps watching.
     */
    fun askBig(kicker: String, headline: String, sub: String, art: String?, yes: String, no: String, selectYes: Boolean = false, onAnswer: (Boolean) -> Unit) {
        dismiss()
        answer = onAnswer
        shownAt = android.os.SystemClock.uptimeMillis()
        val shade = FrameLayout(activity).apply { setBackgroundColor(0xB8000000.toInt()); isClickable = true }
        val c = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(40), dp(34), dp(40), dp(34))
            background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(0xFA1A1614.toInt()); setStroke(dp(2), 0xFF3A322E.toInt()) }
            elevation = dp(16).toFloat()
        }
        val head = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        if (!art.isNullOrEmpty()) {
            val img = android.widget.ImageView(activity).apply {
                scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
                background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(0xFF25201D.toInt()) }
                clipToOutline = true
            }
            head.addView(img, LinearLayout.LayoutParams(dp(150), dp(84)).apply { rightMargin = dp(26) })
            Thread {
                try {
                    val bmp = android.graphics.BitmapFactory.decodeStream(java.net.URL(art.replace("/w1280/", "/w300/").replace("/original/", "/w300/")).openStream())
                    activity.runOnUiThread { if (card != null) img.setImageBitmap(bmp) }
                } catch (_: Exception) { }
            }.start()
        }
        val titles = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        titles.addView(TextView(activity).apply { text = kicker; setTextColor(0xFFFF6A32.toInt()); textSize = 15f; letterSpacing = 0.12f; setTypeface(typeface, Typeface.BOLD) })
        titles.addView(TextView(activity).apply { text = headline; setTextColor(Color.WHITE); textSize = 34f; typeface = displayFace(); letterSpacing = -0.02f; setPadding(0, dp(4), 0, 0) })
        head.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        c.addView(head)
        if (sub.isNotEmpty()) c.addView(TextView(activity).apply { text = sub; setTextColor(0xFFC9C0BA.toInt()); textSize = 20f; setPadding(0, dp(18), 0, 0); setLineSpacing(0f, 1.15f) })
        // Two equal buttons side by side, text centred, room around them for the focus ring and lift.
        val buttons = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(30), 0, dp(6)); clipChildren = false; clipToPadding = false }
        c.clipChildren = false; c.clipToPadding = false
        fun big(label: String, primary: Boolean, onClick: () -> Unit) = button(label, primary, onClick).apply {
            textSize = 21f
            maxLines = 1
            setPadding(dp(16), dp(18), dp(16), dp(18))
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(8); rightMargin = dp(8) }
        }
        // The safe choice comes first and is selected: Keep watching.
        val keep = big(no, !selectYes) { finish(false) }
        val stop = big(yes, selectYes) { finish(true) }
        buttons.addView(keep); buttons.addView(stop)
        c.addView(buttons)
        shade.addView(c, FrameLayout.LayoutParams(dp(820), -2, Gravity.CENTER))
        root.addView(shade, FrameLayout.LayoutParams(-1, -1))
        // card is the shade here, so dismiss() removes the whole thing
        card = shade
        buttonViews = listOf(keep, stop) // left to right: Keep watching, then Stop
        yesIdx = 1
        sel = if (selectYes) 1 else 0
        (if (selectYes) stop else keep).requestFocus()
        c.alpha = 0f; c.scaleX = 0.96f; c.scaleY = 0.96f
        c.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(200).start()
        handler.postDelayed({ if (card === shade) finish(false) }, 60_000)
    }

    /** Back = "Not now" while the card is up. Returns true when the key was used here. */
    fun onKey(e: KeyEvent): Boolean {
        if (card == null) return false
        // The prompt reads the remote itself (not through view focus, which the player's controls can take back).
        when (e.keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> {
                if (e.action == KeyEvent.ACTION_DOWN && buttonViews.size == 2) {
                    sel = if (e.keyCode == KeyEvent.KEYCODE_DPAD_LEFT) 0 else 1
                    buttonViews[sel].requestFocus()
                }
                return true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                if (e.action == KeyEvent.ACTION_UP && android.os.SystemClock.uptimeMillis() - shownAt > 400) finish(sel == yesIdx)
                return true
            }
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> return true
        }
        if (e.keyCode == KeyEvent.KEYCODE_BACK) {
            // The release of the very press that opened this card must not close it again.
            if (e.action == KeyEvent.ACTION_UP && android.os.SystemClock.uptimeMillis() - shownAt > 400) finish(false)
            return true
        }
        return false
    }

    private fun finish(accept: Boolean) {
        val a = answer
        dismiss()
        a?.invoke(accept)
    }

    fun dismiss() {
        handler.removeCallbacksAndMessages(null)
        card?.let { root.removeView(it) }
        card = null
        answer = null
    }

    private fun button(label: String, primary: Boolean, onClick: () -> Unit) = TextView(activity).apply {
        text = label
        textSize = 16f
        setTypeface(typeface, Typeface.BOLD)
        gravity = Gravity.CENTER
        setPadding(dp(22), dp(10), dp(22), dp(10))
        // Same colour focused or not (orange = Join, grey = Not now); focus adds a white ring and a lift.
        setTextColor(if (primary) 0xFF140A05.toInt() else Color.WHITE)
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), GradientDrawable().apply { cornerRadius = dp(999).toFloat(); setColor(if (primary) 0xFFFF7A45.toInt() else 0xFF4A413C.toInt()); setStroke(dp(3), 0xFFEDE6E1.toInt()) })
            addState(intArrayOf(), GradientDrawable().apply { cornerRadius = dp(999).toFloat(); setColor(if (primary) 0xFFFF6A32.toInt() else 0xFF3A322E.toInt()) })
        }
        setOnFocusChangeListener { v, f -> v.animate().scaleX(if (f) 1.08f else 1f).scaleY(if (f) 1.08f else 1f).setDuration(120).start() }
        isFocusable = true
        isClickable = true
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(12) }
    }
}
