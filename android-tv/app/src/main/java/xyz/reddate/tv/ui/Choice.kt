package xyz.reddate.tv.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import xyz.reddate.tv.Engine
import xyz.reddate.tv.objects
import xyz.reddate.tv.str

/** Drawn pictures (no icon font needed): one person, or a few. */
@Composable
fun Glyph(kind: String, tint: Color, size: Dp = 30.dp) {
    Canvas(Modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        fun person(cx: Float, scale: Float, alpha: Float) {
            val r = w * 0.17f * scale
            drawCircle(tint.copy(alpha = alpha), r, Offset(cx, h * 0.33f))
            val bw = w * 0.52f * scale
            drawArc(tint.copy(alpha = alpha), 180f, 180f, true, Offset(cx - bw / 2, h * 0.58f), Size(bw, h * 0.8f * scale))
        }
        if (kind == "group") { person(w * 0.2f, 0.78f, 0.55f); person(w * 0.8f, 0.78f, 0.55f); person(w * 0.5f, 1f, 1f) }
        else person(w * 0.5f, 1f, 1f)
    }
}

private val avatarColors = listOf(Color(0xFFC9F27A), Color(0xFF9AD1FF), Color(0xFFFFB27A), Color(0xFFE0A6FF), Color(0xFFFFE08A), Color(0xFF8FE3C9))
fun avatarColor(name: String): Color = avatarColors[(name.lowercase().fold(0) { a, c -> a * 31 + c.code } and 0x7fffffff) % avatarColors.size]

@Composable
fun AvatarDot(name: String, size: Dp = 44.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(avatarColor(name)), contentAlignment = Alignment.Center) {
        Text(name.trim().take(1).uppercase().ifEmpty { "?" }, color = Color(0xFF1A0F09), fontSize = (size.value * 0.46f).sp, fontWeight = FontWeight.ExtraBold)
    }
}

/** A big choice: picture, title, one line. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ChoiceCard(title: String, sub: String, glyph: String, primary: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    // Both cards rest dark; the one you're on lights up (orange for the main choice, cream for the other),
    // so the highlight always means "this is where you are", never "this one is more important".
    var focused by remember { mutableStateOf(false) }
    val ink = if (!focused) C.ink else if (primary) C.accentInk else C.paper
    Surface(
        onClick = onClick,
        modifier = modifier.onFocusChanged { focused = it.isFocused },
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(24.dp)),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.06f, pressedScale = 0.97f),
        colors = ClickableSurfaceDefaults.colors(containerColor = C.paper3, contentColor = C.ink,
            focusedContainerColor = if (primary) C.accent else C.ink, focusedContentColor = ink,
            pressedContainerColor = if (primary) C.accent else C.ink, pressedContentColor = ink),
        glow = ClickableSurfaceDefaults.glow(focusedGlow = androidx.tv.material3.Glow(Color(0x59F6F1EA), 18.dp))
    ) {
        Column(Modifier.padding(26.dp)) {
            Box(Modifier.size(64.dp).clip(CircleShape).background(if (focused) Color(0x22000000) else Color(0x14FFFFFF)), contentAlignment = Alignment.Center) {
                Glyph(glyph, ink, 34.dp)
            }
            Spacer(Modifier.height(18.dp))
            Text(title, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, fontFamily = Display, color = ink)
            Text(sub, fontSize = 16.sp, color = ink.copy(alpha = 0.78f), modifier = Modifier.padding(top = 4.dp))
        }
    }
}

/** The panel every choice sits in: it eases in. */
@Composable
internal fun Sheet(width: Dp, content: @Composable () -> Unit) {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { a.animateTo(1f, tween(320)) }
    Column(
        Modifier.width(width)
            .graphicsLayer { alpha = a.value; scaleX = 0.94f + 0.06f * a.value; scaleY = 0.94f + 0.06f * a.value }
            .clip(RoundedCornerShape(30.dp)).background(C.paper2)
            .padding(36.dp)
    ) { content() }
}

@Composable
fun WatchChoiceDialog(model: AppModel, d: Dlg.WatchChoice) {
    val first = remember { FocusRequester() }
    Dialog(onDismissRequest = { model.dialog = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Sheet(720.dp) {
            Text("How do you want to watch?", fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, fontFamily = Display, color = C.ink)
            Text(d.label.uppercase(), fontSize = 15.sp, letterSpacing = 2.sp, color = C.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
            Spacer(Modifier.height(28.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                ChoiceCard("Watch alone", "Just you", "person", false, Modifier.weight(1f).focusRequester(first)) { model.send(d.payload, together = false) }
                ChoiceCard("Watch together", "Invite your profiles or friends", "group", true, Modifier.weight(1f)) { model.send(d.payload, together = true) }
            }
        }
    }
    LaunchedEffect(Unit) { delay(80); try { first.requestFocus() } catch (_: Exception) { } }
}

/** A line in the invite list: a person (or everyone), and what pressing does. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun InviteRow(name: String, sub: String, done: Boolean, everyone: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(18.dp)),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.03f),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (everyone) C.accent else C.paper3, contentColor = if (everyone) C.accentInk else C.ink,
            focusedContainerColor = if (everyone) Color(0xFFFF7A45) else Color(0xFF322A26), focusedContentColor = if (everyone) C.accentInk else C.ink
        ),
        border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(3.dp, C.ink), shape = RoundedCornerShape(18.dp)))
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (everyone) Box(Modifier.size(44.dp).clip(CircleShape).background(Color(0x26000000)), contentAlignment = Alignment.Center) { Glyph("group", C.accentInk, 26.dp) }
            else AvatarDot(name)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(name, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (sub.isNotEmpty()) Text(sub, fontSize = 15.sp, color = (if (everyone) C.accentInk else C.muted).copy(alpha = 0.85f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(if (done) "Invited ✓" else "Invite", fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}

@Composable
fun InviteDialog(model: AppModel) {
    val info = model.info
    val first = remember { FocusRequester() }
    var devices by remember { mutableStateOf<List<Triple<String, String, String>>>(emptyList()) }
    var sent by remember { mutableStateOf(setOf<String>()) }
    val scope = rememberCoroutineScope()
    // Keep looking while this is open: a phone or browser tab signed in just now shows up within seconds.
    LaunchedEffect(Unit) {
        while (true) {
            devices = try {
                (Engine.call("devices") as? JSONArray).objects().map { Triple(it.str("id"), it.str("profile").ifEmpty { it.str("device") }, if (it.str("profile").isNotEmpty()) it.str("device") else "") }
            } catch (_: Exception) { devices }
            kotlinx.coroutines.delay(3000)
        }
    }
    Dialog(onDismissRequest = { model.dialog = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Sheet(680.dp) {
            Text("Invite", fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, fontFamily = Display, color = C.ink)
            Text("They get a pop-up to join. You control playback.", fontSize = 17.sp, color = C.muted, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(20.dp))
            if (devices.isNotEmpty()) {
                InviteRow("Invite all my profiles", "${devices.size} ${if (devices.size == 1) "screen" else "screens"} on your account", sent.size >= devices.size, everyone = true,
                    modifier = Modifier.focusRequester(first)) {
                    scope.launch { try { Engine.call("inviteAll"); sent = devices.map { it.first }.toSet() } catch (_: Exception) { } }
                }
                devices.forEach { (id, name, device) ->
                    Spacer(Modifier.height(8.dp))
                    InviteRow(name, device, id in sent) {
                        scope.launch { try { Engine.call("inviteDevice", org.json.JSONObject().put("id", id)); sent = sent + id } catch (_: Exception) { } }
                    }
                }
                Spacer(Modifier.height(18.dp))
            }
            if (info.roomCode.isNotEmpty()) {
                val qr = remember(info.invite) { if (info.invite.isNotEmpty()) qrBitmap(info.invite, 360) else null }
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.paper).padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("PARTY CODE", fontSize = 13.sp, letterSpacing = 2.sp, color = C.muted)
                        Text(info.roomCode, fontSize = 40.sp, fontWeight = FontWeight.Black, letterSpacing = 4.sp, color = C.ink)
                        Text("Join with this code on Reddate TV, or scan to join from a phone or computer", fontSize = 14.sp, color = C.muted, modifier = Modifier.padding(top = 6.dp))
                    }
                    if (qr != null) {
                        Spacer(Modifier.width(16.dp))
                        androidx.compose.foundation.Image(
                            bitmap = qr.asImageBitmap(), contentDescription = "QR code to join this party",
                            modifier = Modifier.size(116.dp).clip(RoundedCornerShape(10.dp)).background(Color.White).padding(8.dp)
                        )
                    }
                }
                Spacer(Modifier.height(18.dp))
            }
            PillButton("Done", { model.dialog = null }, primary = devices.isEmpty(), modifier = Modifier.then(if (devices.isEmpty()) Modifier.focusRequester(first) else Modifier))
        }
    }
    LaunchedEffect(devices.size) { delay(80); try { first.requestFocus() } catch (_: Exception) { } }
}

@Composable
fun RemoveContinueDialog(model: AppModel, item: CwItem) {
    val keep = remember { FocusRequester() }
    // OK is still held down from the long press that opened this, and its release must not press anything here,
    // however long it was held. A button here only works after a fresh press (a key going down, not a repeat).
    var fresh by remember { mutableStateOf(false) }
    fun ready() = fresh
    Dialog(onDismissRequest = { model.dialog = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        androidx.compose.foundation.layout.Box(Modifier.onPreviewKeyEvent {
            if (it.type == androidx.compose.ui.input.key.KeyEventType.KeyDown && it.nativeKeyEvent.repeatCount == 0) fresh = true
            false
        }) {
        Sheet(560.dp) {
            Text("Continue watching", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, fontFamily = Display, color = C.ink)
            Text(item.name, fontSize = 18.sp, color = C.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
            Spacer(Modifier.height(24.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton("Choose another stream", { if (ready()) { model.dialog = null; model.chooseStream(item) } }, primary = true, modifier = Modifier.focusRequester(keep))
                PillButton("Remove", { if (ready()) { model.dialog = null; model.forgetContinue(item) } })
                PillButton("Close", { if (ready()) model.dialog = null })
            }
            Text("Remove forgets your place in it.", fontSize = 14.sp, color = C.muted, modifier = Modifier.padding(top = 14.dp))
        }
        }
    }
    LaunchedEffect(Unit) { delay(80); try { keep.requestFocus() } catch (_: Exception) { } }
}

/** Check for, download and install a new version of the app. */
@Composable
fun UpdateDialog(model: AppModel) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val installed = remember { xyz.reddate.tv.Updater.installedName(ctx) }
    val code = remember { xyz.reddate.tv.Updater.installedCode(ctx) }
    var state by remember { mutableStateOf("checking") } // checking, uptodate, available, downloading, ready, permission, error
    var progress by remember { mutableStateOf(0f) }
    var error by remember { mutableStateOf("") }
    var file by remember { mutableStateOf<java.io.File?>(null) }
    val first = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        val l = xyz.reddate.tv.Updater.latest()
        if (l == null) { error = "Couldn't reach the server. Check your connection."; state = "error" }
        else if (l.code > code) { model.update = l; state = "available" }
        else { model.update = null; state = "uptodate" }
    }
    LaunchedEffect(state) { delay(80); try { first.requestFocus() } catch (_: Exception) { } }

    fun startDownload() {
        val info = model.update ?: return
        state = "downloading"; progress = 0f
        scope.launch {
            try {
                file = xyz.reddate.tv.Updater.download(ctx, info) { progress = it }
                if (xyz.reddate.tv.Updater.canInstall(ctx)) { state = "ready"; xyz.reddate.tv.Updater.install(ctx, file!!) }
                else state = "permission"
            } catch (e: Exception) { error = e.message ?: "The download failed."; state = "error" }
        }
    }

    Dialog(onDismissRequest = { model.dialog = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Sheet(620.dp) {
            Text("Reddate TV updates", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, fontFamily = Display, color = C.ink)
            Text("You have version $installed", fontSize = 16.sp, color = C.muted, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(20.dp))
            val u = model.update
            when (state) {
                "checking" -> Text("Checking for a new version…", fontSize = 18.sp, color = C.ink)
                "uptodate" -> {
                    Text("You're up to date.", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = C.ink)
                    Spacer(Modifier.height(20.dp))
                    PillButton("Done", { model.dialog = null }, primary = true, modifier = Modifier.focusRequester(first))
                }
                "available" -> {
                    Text("Version ${u?.name} is ready", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, fontFamily = Display, color = C.ink)
                    val mb = (u?.size ?: 0L) / 1048576.0
                    if (mb > 0) Text(String.format(java.util.Locale.US, "%.1f MB", mb), fontSize = 15.sp, color = C.muted)
                    Spacer(Modifier.height(16.dp))
                    // The buttons come first, so a long list of changes can never push them off the card or squash them.
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        PillButton("Update now", { startDownload() }, primary = true, modifier = Modifier.focusRequester(first))
                        PillButton("Later", { model.dialog = null })
                    }
                    // What's new: one bullet per "|" in the release notes (or per line).
                    val points = (u?.notes ?: "").split('|', '\n').map { it.trim() }.filter { it.isNotEmpty() }
                    if (points.isNotEmpty()) {
                        Text("WHAT'S NEW", fontSize = 13.sp, letterSpacing = 2.sp, color = C.muted, modifier = Modifier.padding(top = 20.dp, bottom = 6.dp))
                        Column(Modifier.heightIn(max = 230.dp).verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                            points.take(14).forEach { pt ->
                                Row(Modifier.padding(bottom = 6.dp)) {
                                    Text("•", fontSize = 17.sp, color = C.accent, modifier = Modifier.width(18.dp))
                                    Text(pt, fontSize = 17.sp, color = C.ink)
                                }
                            }
                        }
                    }
                }
                "downloading" -> {
                    Text("Downloading…", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = C.ink)
                    Spacer(Modifier.height(14.dp))
                    Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(Color(0x33FFFFFF))) {
                        Box(Modifier.fillMaxWidth(progress.coerceIn(0.02f, 1f)).height(8.dp).clip(RoundedCornerShape(4.dp)).background(C.accent))
                    }
                    Text("${(progress * 100).toInt()}%", fontSize = 15.sp, color = C.muted, modifier = Modifier.padding(top = 8.dp))
                }
                "ready" -> {
                    Text("Press Install on the next screen.", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = C.ink)
                    Text("Reddate TV closes while it updates. Open it again afterwards.", fontSize = 16.sp, color = C.muted, modifier = Modifier.padding(top = 6.dp))
                    Spacer(Modifier.height(20.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        PillButton("Install again", { file?.let { xyz.reddate.tv.Updater.install(ctx, it) } }, primary = true, modifier = Modifier.focusRequester(first))
                        PillButton("Close", { model.dialog = null })
                    }
                }
                "permission" -> {
                    Text("Allow Reddate TV to install updates", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = C.ink)
                    Text("Android asks once. Open the setting, switch on \"Allow from this source\", press Back, then come here and try again.", fontSize = 16.sp, color = C.muted, modifier = Modifier.padding(top = 6.dp))
                    Spacer(Modifier.height(20.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        PillButton("Open the setting", { xyz.reddate.tv.Updater.openInstallPermission(ctx) }, primary = true, modifier = Modifier.focusRequester(first))
                        PillButton("Try again", { if (xyz.reddate.tv.Updater.canInstall(ctx) && file != null) { state = "ready"; xyz.reddate.tv.Updater.install(ctx, file!!) } })
                    }
                }
                else -> {
                    Text(error, fontSize = 18.sp, color = C.ink)
                    Spacer(Modifier.height(20.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        PillButton("Try again", { state = "checking"; scope.launch { val l = xyz.reddate.tv.Updater.latest(); if (l == null) { error = "Couldn't reach the server."; state = "error" } else if (l.code > code) { model.update = l; state = "available" } else { state = "uptodate" } } }, primary = true, modifier = Modifier.focusRequester(first))
                        PillButton("Close", { model.dialog = null })
                    }
                }
            }
        }
    }
}

/** In someone else's watch party, you picked something else: leave the party to watch it, or stay. */
@Composable
fun LeaveToPlayDialog(model: AppModel, d: Dlg.LeaveToPlay) {
    val stay = remember { FocusRequester() }
    val host = model.info.hostName.ifEmpty { "the host" }
    Dialog(onDismissRequest = { model.dialog = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Sheet(620.dp) {
            Text("You're in $host's watch party", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, fontFamily = Display, color = C.ink)
            Text("Only $host picks what plays for the party. Leave it to watch ${d.label} on your own?", fontSize = 17.sp, color = C.muted, modifier = Modifier.padding(top = 6.dp))
            Spacer(Modifier.height(24.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton("Stay in the party", { model.dialog = null }, modifier = Modifier.focusRequester(stay))
                PillButton("Leave and watch this", { model.dialog = null; model.leaveRoom { model.dialog = Dlg.WatchChoice(d.label, d.payload) } }, primary = true)
            }
        }
    }
    LaunchedEffect(Unit) { delay(80); try { stay.requestFocus() } catch (_: Exception) { } }
}
