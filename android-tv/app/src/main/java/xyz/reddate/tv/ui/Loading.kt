package xyz.reddate.tv.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text

/**
 * "Working on it": the title's picture breathing slowly with a small spinner and what's happening, over
 * everything. Back cancels. Used for finding a stream, checking a link, and the like.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun LoadingOverlay(busy: Busy, onCancel: () -> Unit) {
    val t = rememberInfiniteTransition(label = "breathe")
    val breathe by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1900), RepeatMode.Reverse), label = "b")
    val spin by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1100, easing = LinearEasing)), label = "s")
    Box(
        Modifier.fillMaxSize().background(Color(0xF20D0B0A))
            .onPreviewKeyEvent { e ->
                if (e.key == Key.Back || e.key == Key.Escape) { if (e.type == KeyEventType.KeyUp) onCancel(); true } else e.type == KeyEventType.KeyDown || e.type == KeyEventType.KeyUp
            },
        contentAlignment = Alignment.Center
    ) {
        // The picture, large and dim behind everything, breathing a little.
        if (busy.art.startsWith("http")) {
            Img(
                busy.art.replace("/w1280/", "/w780/").replace("/original/", "/w780/"),
                Modifier.fillMaxSize().scale(1.04f + 0.04f * breathe).alpha(0.22f + 0.10f * breathe)
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(busy.title, style = MaterialTheme.typography.displaySmall, color = C.ink, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 760.dp))
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Canvas(Modifier.size(26.dp).rotate(spin)) {
                    drawArc(C.accent, startAngle = 0f, sweepAngle = 270f, useCenter = false, style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round), topLeft = Offset(2.dp.toPx(), 2.dp.toPx()), size = Size(size.width - 4.dp.toPx(), size.height - 4.dp.toPx()))
                }
                Spacer(Modifier.width(14.dp))
                androidx.tv.material3.Text(busy.text, style = MaterialTheme.typography.titleMedium, color = C.muted.copy(alpha = 0.7f + 0.3f * breathe))
            }
            Spacer(Modifier.height(26.dp))
            Text("Back to cancel", style = MaterialTheme.typography.labelMedium, color = C.muted)
        }
    }
}

/** Just the title's picture, dim, full screen: what stays behind a question or the moment before the player opens. */
@Composable
fun PosterBackdrop(busy: Busy) {
    Box(Modifier.fillMaxSize().background(Color(0xFF0D0B0A))) {
        if (busy.art.startsWith("http")) {
            Img(busy.art.replace("/w1280/", "/w780/").replace("/original/", "/w780/"), Modifier.fillMaxSize().alpha(0.30f))
        }
    }
}
