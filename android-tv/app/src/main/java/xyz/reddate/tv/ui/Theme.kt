package xyz.reddate.tv.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Typography
import androidx.tv.material3.darkColorScheme
import xyz.reddate.tv.R

// Reddate's colours, the same as tv.reddate.xyz: a dark screening room, warm off-white ink, one orange for actions.
object C {
    val paper = Color(0xFF0D0B0A)
    val paper2 = Color(0xFF1A1614)
    val paper3 = Color(0xFF25201D)
    val paper4 = Color(0xFF322A26)
    val ink = Color(0xFFF6F1EA)
    val muted = Color(0xFFBFB3A6)
    val accent = Color(0xFFFF6A32)
    val accentInk = Color(0xFF160C07)
    val scrim = Color(0xCC000000)
}

// Display type (titles, headings, big numbers) is Bricolage Grotesque; everything else is Hanken Grotesk.
// Both are variable fonts: each weight is one instance of the same file.
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun variable(res: Int, w: Int) = Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
val Display = FontFamily(variable(R.font.bricolage, 600), variable(R.font.bricolage, 700), variable(R.font.bricolage, 800))
val TextFace = FontFamily(variable(R.font.hanken, 400), variable(R.font.hanken, 500), variable(R.font.hanken, 600), variable(R.font.hanken, 700))

// Motion: one easing for everything that enters, one spring for focus so cards settle instead of snapping.
val emphasizedEase = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
fun <T> focusSpring() = spring<T>(dampingRatio = 0.78f, stiffness = Spring.StiffnessMediumLow)

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ReddateTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = C.accent, onPrimary = C.accentInk,
            background = C.paper, onBackground = C.ink,
            surface = C.paper2, onSurface = C.ink, surfaceVariant = C.paper3, onSurfaceVariant = C.muted,
            border = C.muted, inverseSurface = C.ink, inverseOnSurface = C.paper
        ),
        typography = Typography(
            displayLarge = TextStyle(fontFamily = Display, fontSize = 64.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 64.sp, letterSpacing = (-1.6).sp),
            displayMedium = TextStyle(fontFamily = Display, fontSize = 48.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 50.sp, letterSpacing = (-1.2).sp),
            displaySmall = TextStyle(fontFamily = Display, fontSize = 38.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 42.sp, letterSpacing = (-0.9).sp),
            headlineMedium = TextStyle(fontFamily = Display, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 32.sp, letterSpacing = (-0.5).sp),
            headlineSmall = TextStyle(fontFamily = Display, fontSize = 23.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 28.sp, letterSpacing = (-0.4).sp),
            titleLarge = TextStyle(fontFamily = Display, fontSize = 20.sp, fontWeight = FontWeight.Bold, lineHeight = 24.sp, letterSpacing = (-0.2).sp),
            titleMedium = TextStyle(fontFamily = TextFace, fontSize = 16.sp, fontWeight = FontWeight.Bold, lineHeight = 22.sp),
            titleSmall = TextStyle(fontFamily = TextFace, fontSize = 14.sp, fontWeight = FontWeight.Bold, lineHeight = 20.sp),
            bodyLarge = TextStyle(fontFamily = TextFace, fontSize = 16.sp, lineHeight = 23.sp),
            bodyMedium = TextStyle(fontFamily = TextFace, fontSize = 14.sp, lineHeight = 20.sp),
            bodySmall = TextStyle(fontFamily = TextFace, fontSize = 12.sp, lineHeight = 16.sp),
            labelLarge = TextStyle(fontFamily = TextFace, fontSize = 14.sp, fontWeight = FontWeight.Bold),
            labelMedium = TextStyle(fontFamily = TextFace, fontSize = 12.sp, fontWeight = FontWeight.Bold),
            labelSmall = TextStyle(fontFamily = TextFace, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        ),
        content = content
    )
}
