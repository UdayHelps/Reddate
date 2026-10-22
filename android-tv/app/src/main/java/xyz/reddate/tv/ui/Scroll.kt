package xyz.reddate.tv.ui

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.KeyEvent as ComposeKeyEvent

/**
 * How lists follow the remote. Modelled on how Nuvio TV does it: the focused item is pinned at a
 * fixed place in the viewport and the content glides there on a soft, nearly critically damped
 * spring. A spring carries its velocity across key presses, so quick presses flow into each other
 * instead of restarting an animation each time (that restart is what makes a tween look jerky).
 */
@OptIn(ExperimentalFoundationApi::class)
private class PinnedSpec(private val pin: Float, override val scrollAnimationSpec: AnimationSpec<Float>) : BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float {
        val d = offset - containerSize * pin
        // Already (almost) where it should be: don't nudge by a pixel or two.
        return if (kotlin.math.abs(d) < 3f) 0f else d
    }
}

/** A list that never scrolls by itself to follow focus: the screen moves it (one whole row at a time on Home). */
@OptIn(ExperimentalFoundationApi::class)
private object NoFollowSpec : BringIntoViewSpec {
    override val scrollAnimationSpec: AnimationSpec<Float> = spring()
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float = 0f
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NoFollow(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalBringIntoViewSpec provides NoFollowSpec, content = content)
}

/** Moves a list only as far as needed to show what has focus: anything already on screen stays put. */
@OptIn(ExperimentalFoundationApi::class)
private object MinimalSpec : BringIntoViewSpec {
    override val scrollAnimationSpec: AnimationSpec<Float> = spring(dampingRatio = 0.95f, stiffness = 220f)
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float {
        val end = offset + size
        return when {
            offset >= 0f && end <= containerSize -> 0f
            size >= containerSize || offset < 0f -> offset
            else -> end - containerSize
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MinimalFollow(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalBringIntoViewSpec provides MinimalSpec, content = content)
}

/** Vertical lists: the focused row's top sits at [pin] of the height. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun VerticalPin(pin: Float = 0.09f, content: @Composable () -> Unit) {
    val spec = remember(pin) { PinnedSpec(pin, spring(dampingRatio = 0.95f, stiffness = 180f)) }
    CompositionLocalProvider(LocalBringIntoViewSpec provides spec, content = content)
}

/** Rows: the focused poster stays near the left edge while the row glides (the feel you liked in "More like this"). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HorizontalPin(pin: Float = 0.1f, durationMs: Int = 260, content: @Composable () -> Unit) {
    val spec = remember(pin, durationMs) { PinnedSpec(pin, tween(durationMs, easing = CubicBezierEasing(0.2f, 0f, 0f, 1f))) }
    CompositionLocalProvider(LocalBringIntoViewSpec provides spec, content = content)
}

/**
 * Holding a direction key sends a flood of repeats; moving on every one is what makes lists race
 * and stutter. Repeats are let through at a steady pace instead (first press is never delayed).
 */
fun Modifier.dpadThrottle(horizontalGateMs: Long = 95L, verticalGateMs: Long = 170L): Modifier = composed {
    var last by remember { mutableLongStateOf(0L) }
    Modifier.onPreviewKeyEvent { e ->
        if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
        val gate = when (e.key) {
            Key.DirectionLeft, Key.DirectionRight -> horizontalGateMs
            Key.DirectionUp, Key.DirectionDown -> verticalGateMs
            else -> return@onPreviewKeyEvent false
        }
        val ne = e.nativeKeyEvent as android.view.KeyEvent
        val now = ne.eventTime
        if (ne.repeatCount > 0 && now - last < gate) return@onPreviewKeyEvent true // swallow
        last = now
        false
    }
}

/**
 * Remembers which child of a row had focus and sends focus back to it when the row is entered
 * again (Up/Down into a row lands where you left it). Done by hand: Compose's own focusRestorer
 * crashes ("Release should only be called once") when used inside lazy lists that recycle rows.
 */
class RowMemory {
    val requesters = HashMap<Any, androidx.compose.ui.focus.FocusRequester>()
    var last: Any? = null
    fun requester(key: Any) = requesters.getOrPut(key) { androidx.compose.ui.focus.FocusRequester() }
}

@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
fun Modifier.restoreFocus(mem: RowMemory): Modifier = this.focusProperties {
    enter = { _ ->
        val k = mem.last
        val r = if (k != null) mem.requesters[k] else null
        r ?: androidx.compose.ui.focus.FocusRequester.Default
    }
}

/** For each item in a row: register it with the row's memory and record it when focused. */
fun Modifier.remembered(mem: RowMemory, key: Any): Modifier =
    this.focusRequester(mem.requester(key)).onFocusChanged { if (it.isFocused) mem.last = key }


/**
 * Moves a list so [index] sits at its start, as one smooth glide (a fixed-length ease-out) instead of the library's
 * default jump. Rows that are already on screen are slid by exactly the distance needed; far ones fall back to the
 * normal scroll. Starting a new glide while one runs simply takes over from where it is.
 */
suspend fun androidx.compose.foundation.lazy.LazyListState.glideTo(index: Int, ms: Int = 440) {
    val info = layoutInfo.visibleItemsInfo.firstOrNull { it.index == index }
    if (info == null) { animateScrollToItem(index); return }
    val delta = (info.offset - layoutInfo.beforeContentPadding).toFloat()
    if (kotlin.math.abs(delta) < 2f) return
    this.animateScrollBy(delta, tween(ms, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
}
