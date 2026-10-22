package xyz.reddate.tv.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import xyz.reddate.tv.Langs

/**
 * The streams page. It opens over the title as its own window (so the page behind can't take focus, and Back closes it),
 * and shows everything you can filter by at once: a language search box, quality, language and addon on the left, the
 * streams on the right with the best match (your usual, then the fastest) on top.
 */
@OptIn(ExperimentalTvMaterial3Api::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
fun StreamSheet(
    model: AppModel, title: String, streams: List<Stream>?, notes: List<StreamNote>, why: String, streamError: String,
    checking: Boolean, onPlay: (Stream) -> Unit, onClose: () -> Unit
) {
    // ---- filters ----
    var tier by remember { mutableStateOf("All") }
    var addonPick by remember { mutableStateOf("") }
    var langPick by remember { mutableStateOf("") }
    var langQ by remember { mutableStateOf("") }
    val sList = streams.orEmpty()
    // What each stream's name says about languages, worked out once per list (not on every redraw).
    val scans = remember(sList) { sList.associate { it.url to Langs.scan("${it.name} ${it.title} ${it.filename}") } }
    val langOptions = remember(sList) {
        scans.values.flatten().groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.take(7).map { it.key to it.value }
    }
    val addons = remember(sList) { sList.map { it.addon.ifEmpty { "Other" } }.distinct() }
    val effAddon = if (addonPick in addons) addonPick else ""
    val q = langQ.trim().lowercase()
    val qFlag = if (q.length >= 3) Langs.flag(q) else ""
    fun bucket(st: Stream) = when (model.tierOf(st)) { "4K" -> "4K"; "1080p" -> "1080p"; else -> "720p & below" }
    val bucketOrder = listOf("4K", "1080p", "720p & below")
    fun langOk(st: Stream): Boolean {
        val found = scans[st.url].orEmpty()
        if (langPick.isNotEmpty() && langPick !in found) return false
        if (q.isEmpty()) return true
        val t = "${st.name} ${st.title} ${st.filename}"
        return t.lowercase().contains(q) || (qFlag.isNotEmpty() && t.contains(qFlag)) || found.any { it.startsWith(q) }
    }
    val base = sList.filter { (effAddon.isEmpty() || it.addon.ifEmpty { "Other" } == effAddon) && langOk(it) }
    val tierGroups = listOf("All" to base) + bucketOrder.map { b -> b to base.filter { bucket(it) == b } }.filter { it.second.isNotEmpty() }
    val inTier = tierGroups.firstOrNull { it.first == tier }?.second ?: base
    // Quickest first in every view, "Any quality" included: the quality is on each card, the speed decides the order.
    fun ordered(l: List<Stream>): List<Stream> = model.byLatency(l.distinctBy { it.url })
    // The list re-orders live as replies come in, so the quickest stream is always on top. If you have moved down the list to
    // a card, it stays put under you until you are back on the first one.
    val first = remember { FocusRequester() }
    var focusedCard by remember { mutableStateOf("") }
    var chosen by remember(tier, effAddon, langPick, q) { mutableStateOf(ordered(inTier)) }
    val doneCount = inTier.count { model.probes[it.url] != null }
    val speedCount = inTier.count { val g = model.probes[it.url]?.grade; g != null && g != xyz.reddate.tv.StreamProbe.Grade.PINGED }
    val onTop = focusedCard.isEmpty() || focusedCard == chosen.firstOrNull()?.url
    LaunchedEffect(doneCount, speedCount, onTop, inTier.size) {
        if (!onTop) return@LaunchedEffect
        kotlinx.coroutines.delay(250) // replies arrive in bursts: one re-order per burst
        val wasOnFirst = focusedCard.isNotEmpty()
        val next = ordered(inTier)
        if (next.map { it.url } != chosen.map { it.url }) {
            chosen = next
            // You were on the first card: you stay on the first card, which is now the quickest one.
            if (wasOnFirst) { kotlinx.coroutines.delay(90); try { first.requestFocus() } catch (_: Exception) { } }
        }
    }
    LaunchedEffect(tier, effAddon, langPick, q) {
        // Ping everything in this view at once (about a second), then speed-test the quickest few.
        model.probe(inTier.filter { model.probes[it.url] == null })
        model.probeRest(inTier)
    }
    val PAGE = 5
    var shown by remember(tier, effAddon, langPick, q) { mutableStateOf(PAGE) }
    val listState = rememberLazyListState()
    // The first card takes focus as soon as the streams are in, so the next press plays.
    LaunchedEffect(streams != null && streams.isNotEmpty()) {
        if (streams.isNullOrEmpty()) return@LaunchedEffect
        repeat(12) { kotlinx.coroutines.delay(70); try { first.requestFocus(); return@LaunchedEffect } catch (_: Exception) { } }
    }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val enter = remember { Animatable(0f) }
        LaunchedEffect(Unit) { enter.animateTo(1f, tween(360, easing = emphasizedEase)) }
        Box(Modifier.fillMaxSize().dpadThrottle()) {
            Box(Modifier.fillMaxSize().graphicsLayer { alpha = enter.value }
                .background(Brush.horizontalGradient(0f to Color.Transparent, 0.3f to C.paper.copy(alpha = 0.55f), 0.7f to C.paper.copy(alpha = 0.94f))))
            Row(
                Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(820.dp)
                    .graphicsLayer { alpha = enter.value; translationX = (1f - enter.value) * size.width * 0.12f }
                    .background(C.paper2.copy(alpha = 0.99f)).padding(start = 28.dp, top = 30.dp)
            ) {
                // ---- filters ----
                LazyColumn(Modifier.width(250.dp).fillMaxHeight().focusProperties { exit = { d -> if (d == androidx.compose.ui.focus.FocusDirection.Left) FocusRequester.Cancel else FocusRequester.Default } },
                    contentPadding = PaddingValues(bottom = 60.dp, end = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    item(key = "q") {
                        Column {
                            Text("Search language", style = MaterialTheme.typography.labelMedium, color = C.muted, modifier = Modifier.padding(bottom = 6.dp))
                            TvTextField(langQ, { langQ = it }, "Hindi, English, Tamil…", {}, Modifier.fillMaxWidth())
                        }
                    }
                    item(key = "h-quality") { FilterHeading("Quality") }
                    items(tierGroups, key = { "t:" + it.first }) { (t, l) -> FilterRow(if (t == "All") "Any quality" else t, l.size, tier == t) { tier = t } }
                }
                Spacer(Modifier.width(20.dp))
                // ---- streams ----
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    Text(title, style = MaterialTheme.typography.displaySmall.copy(fontSize = 30.sp), color = C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 28.dp))
                    val n = sList.size
                    val active = listOfNotNull(tier.takeIf { it != "All" }, langPick.takeIf { it.isNotEmpty() }?.replaceFirstChar { it.uppercase() }, effAddon.takeIf { it.isNotEmpty() }, langQ.trim().takeIf { it.isNotEmpty() }?.let { "“$it”" })
                    Text(
                        when {
                            streams == null -> if (checking) "Getting your streams ready…" else "Asking your addons…"
                            n == 0 -> "Nothing found"
                            active.isNotEmpty() -> "${chosen.size} of $n · ${active.joinToString(" · ")}"
                            else -> "$n stream${if (n == 1) "" else "s"} · your usual first, then the fastest"
                        },
                        style = MaterialTheme.typography.bodyMedium, color = C.muted, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp, end = 28.dp)
                    )
                    val list = streams
                    when {
                        list == null -> Box(Modifier.fillMaxSize().padding(end = 28.dp)) { StreamsLoading(if (checking) "Getting your streams ready" else "Finding streams") }
                        list.isEmpty() -> Column(Modifier.padding(end = 28.dp)) {
                            Text(if (streamError.isNotEmpty()) "Couldn’t get streams ($streamError)." else "No streams found.", color = C.ink, style = MaterialTheme.typography.titleMedium)
                            if (why.isNotEmpty() && streamError.isEmpty()) Text(why, color = C.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                            Spacer(Modifier.height(12.dp))
                            PillButton("Add a stream addon", { onClose(); model.go(Screen.Addons) })
                        }
                        else -> LazyColumn(state = listState, contentPadding = PaddingValues(bottom = 60.dp, top = 6.dp, end = 28.dp, start = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            // With more than one addon: a row to switch between them (Left and Right change it right away).
                            if (addons.size > 1) item(key = "addon-row") {
                                androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
                                    item(key = "all") { AddonChip("All", sList.size, "", effAddon.isEmpty()) { addonPick = "" } }
                                    items(addons, key = { "a:$it" }) { a ->
                                        val l = sList.filter { st -> st.addon.ifEmpty { "Other" } == a }
                                        AddonChip(a, l.size, l.firstOrNull()?.logo ?: "", effAddon == a) { addonPick = a }
                                    }
                                }
                            }
                            val shownNotes = notes.filter { effAddon.isEmpty() || it.addon == effAddon }
                            if (shownNotes.isNotEmpty()) item(key = "notes") {
                                androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    items(shownNotes, key = { it.addon + "|" + it.title + "|" + it.link }) { nt -> AddonNoteChip(nt) { model.dialog = Dlg.AddonNote(nt) } }
                                }
                            }
                            if (chosen.isEmpty()) item(key = "empty") {
                                Column {
                                    Text("No streams match these filters.", color = C.ink, style = MaterialTheme.typography.titleMedium)
                                    Text("Pick “Any” in a group on the left, or clear the language box.", color = C.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                                }
                            }
                            itemsIndexed(chosen.take(shown), key = { _, st -> "card:" + st.url }) { i, st ->
                                StreamRow(model, st, (if (i == 0) Modifier.focusRequester(first) else Modifier).onFocusChanged { f ->
                                    if (f.isFocused) focusedCard = st.url else if (focusedCard == st.url) focusedCard = ""
                                }) { onPlay(st) }
                            }
                            if (chosen.size > shown) item(key = "more") { PillButton("Show more (${chosen.size - shown} left)", { shown += PAGE }) }
                        }
                    }
                }
            }
        }
    }
}

/** One stream. The connection check is read here, so a new result redraws only this card, not the whole page. */
@Composable
private fun StreamRow(model: AppModel, st: Stream, modifier: Modifier, onClick: () -> Unit) {
    val probe = model.probes[st.url]
    val warn = remember(st.url) { model.fits(st).reason }
    StreamCard(st, modifier, warn = warn, probe = probe, width = 500.dp, onClick = onClick)
}

@Composable
private fun FilterHeading(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = C.muted, modifier = Modifier.padding(top = 14.dp, bottom = 2.dp, start = 4.dp))
}

/** One choice in a filter group: the selected one is marked with a bar; the one the remote is on lights up. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun FilterRow(label: String, count: Int?, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(42.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(12.dp)),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.03f),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (selected) C.ink.copy(alpha = 0.13f) else Color.Transparent,
            contentColor = if (selected) C.ink else C.muted,
            focusedContainerColor = C.ink, focusedContentColor = C.paper
        )
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(width = 3.dp, height = 18.dp).clip(RoundedCornerShape(2.dp)).background(if (selected) C.accent else Color.Transparent))
            Spacer(Modifier.width(10.dp))
            Text(label, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (count != null) Text("$count", style = MaterialTheme.typography.labelMedium)
        }
    }
}
