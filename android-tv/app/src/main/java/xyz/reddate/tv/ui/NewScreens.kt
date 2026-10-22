package xyz.reddate.tv.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** My List: everything you saved, newest first, with Tonight's Pick one press away. */
@Composable
fun MyListScreen(model: AppModel) {
    LaunchedEffect(model.info.profileId) { model.loadMyList() }
    val first = remember { FocusRequester() }
    val list = model.myList.toList()
    Column(Modifier.fillMaxSize().padding(start = LocalRailInset.current + 22.dp, end = SIDE + 22.dp, top = 36.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("My List", style = MaterialTheme.typography.displayMedium, color = C.ink)
                Text(if (list.isEmpty()) "Nothing saved yet" else "${list.size} title${if (list.size == 1) "" else "s"} saved for ${model.info.profile.ifEmpty { "you" }}",
                    style = MaterialTheme.typography.bodyLarge, color = C.muted, modifier = Modifier.padding(top = 4.dp))
            }
            PillButton("Tonight's Pick", { model.go(Screen.Pick) }, primary = true, icon = Icons.Default.Refresh, modifier = if (list.isEmpty()) Modifier.focusRequester(first) else Modifier)
        }
        Spacer(Modifier.height(24.dp))
        if (list.isEmpty()) {
            Text("Press My List on any title (on Home or its page) and it waits here for later.", style = MaterialTheme.typography.bodyLarge, color = C.ink, modifier = Modifier.width(560.dp))
            Spacer(Modifier.height(18.dp))
            PillButton("Browse Home", { model.home() }, icon = Icons.Default.Home)
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(150.dp),
                contentPadding = PaddingValues(top = 10.dp, bottom = 60.dp, start = 4.dp, end = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
                verticalArrangement = Arrangement.spacedBy(26.dp)
            ) {
                items(list, key = { it.id }) { m ->
                    Column {
                        PosterCard(m, onClick = { model.go(Screen.Title(m)) }, width = 150.dp, modifier = if (m === list.first()) Modifier.focusRequester(first) else Modifier)
                        Text(m.name, style = MaterialTheme.typography.titleSmall, color = C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 10.dp).width(150.dp))
                    }
                }
            }
        }
    }
    LaunchedEffect(Unit) { repeat(10) { delay(90); try { first.requestFocus(); return@LaunchedEffect } catch (_: Exception) { } } }
}

/**
 * Tonight's Pick: for when nobody can decide. A strip of posters glides past and eases to a stop on one title.
 * It's one continuous move (a single animation, drawn on the GPU layer), not poster-to-poster steps, so it stays
 * smooth; the pool is My List plus the first rows on Home.
 */
@Composable
fun PickScreen(model: AppModel) {
    val pool = remember(model.rows, model.myList.size) {
        (model.myList.toList() + model.rows.take(4).flatMap { it.items.value }).distinctBy { it.id }.filter { it.poster.isNotEmpty() }
    }
    var kind by remember { mutableStateOf(0) } // 0 anything, 1 movies, 2 series, 3 my list
    val chosenPool = when (kind) {
        1 -> pool.filter { !it.isSeries }
        2 -> pool.filter { it.isSeries }
        3 -> pool.filter { model.inMyList(it.id) }
        else -> pool
    }.ifEmpty { pool }
    var strip by remember { mutableStateOf<List<Meta>>(emptyList()) }
    var winnerIdx by remember { mutableStateOf(0) }
    var spinTick by remember { mutableStateOf(0) }
    var spinning by remember { mutableStateOf(true) }
    var bg by remember { mutableStateOf("") }
    val pos = remember { Animatable(0f) } // where the strip is, in posters
    val watch = remember { FocusRequester() }
    val density = androidx.compose.ui.platform.LocalDensity.current
    val stepPx = with(density) { 146.dp.toPx() }
    LaunchedEffect(spinTick, kind, pool.size) {
        if (chosenPool.isEmpty()) { spinning = false; return@LaunchedEffect }
        // The title you were on stays at the start, so each spin carries on from where the last one stopped.
        val run = ArrayList<Meta>()
        strip.getOrNull(winnerIdx)?.let { if (it in chosenPool) run += it }
        val fresh = chosenPool.shuffled()
        var k = 0
        while (run.size < 26) { val c = fresh[k % fresh.size]; k++; if (run.isEmpty() || run.last().id != c.id || fresh.size == 1) run += c }
        strip = run
        winnerIdx = 19 + (0..4).random()
        spinning = true
        pos.snapTo(0f)
        // Quick away, then a long, soft slow-down.
        pos.animateTo(winnerIdx.toFloat(), tween(6200, easing = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0.55f, 0.15f, 1f)))
        spinning = false
        bg = run[winnerIdx].heroImage
        try { watch.requestFocus() } catch (_: Exception) { }
    }
    val pick = strip.getOrNull(winnerIdx)
    val reveal by animateFloatAsState(if (spinning) 0f else 1f, tween(600, easing = emphasizedEase), label = "reveal")
    Box(Modifier.fillMaxSize().background(C.paper)) {
        androidx.compose.animation.Crossfade(targetState = bg, animationSpec = tween(800), label = "pickBg", modifier = Modifier.fillMaxSize()) { url ->
            if (url.isNotEmpty()) Img(url, Modifier.fillMaxSize().graphicsLayer { alpha = 0.3f })
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to C.paper.copy(alpha = 0.55f), 0.5f to C.paper.copy(alpha = 0.78f), 1f to C.paper)))
        Column(Modifier.fillMaxSize().padding(top = 18.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Can't decide? Let the TV pick.", style = MaterialTheme.typography.headlineMedium, color = C.ink)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("Anything", "Movies", "Series", "My List").forEachIndexed { i, label -> PillButton(label, { kind = i; spinTick++ }, primary = kind == i) }
            }
            Spacer(Modifier.height(4.dp))
            // The strip: every poster sits at the middle and is moved sideways by how far it is from the current spot.
            Box(Modifier.fillMaxWidth().height(232.dp), contentAlignment = Alignment.Center) {
                strip.forEachIndexed { i, m ->
                    Box(Modifier.width(96.dp).aspectRatio(2f / 3f).graphicsLayer {
                        val d = i - pos.value
                        val a = kotlin.math.abs(d)
                        translationX = d * stepPx
                        val sc = 1.4f - 0.4f * minOf(a, 1f)
                        scaleX = sc; scaleY = sc
                        alpha = 1f - 0.72f * minOf(a / 2.4f, 1f)
                    }.clip(RoundedCornerShape(12.dp)).background(C.paper3)) {
                        Img(m.poster, Modifier.fillMaxSize())
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            Column(Modifier.graphicsLayer { alpha = reveal; translationY = (1f - reveal) * 14f }, horizontalAlignment = Alignment.CenterHorizontally) {
                Text(pick?.name ?: if (chosenPool.isEmpty()) "Add some titles to My List first" else "", style = MaterialTheme.typography.headlineSmall, color = C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (pick != null && pick.facts.isNotEmpty()) Text(pick.facts, style = MaterialTheme.typography.bodyMedium, color = C.muted, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton("Watch this", { pick?.let { model.go(Screen.Title(it, autoPlay = true)) } }, primary = true, icon = Icons.Default.PlayArrow, modifier = Modifier.focusRequester(watch))
                PillButton("Spin again", { spinTick++ }, icon = Icons.Default.Refresh)
            }
        }
    }
}

/** An actor (or director): their photo, what they're known for, and the titles of theirs you can open. */
@Composable
fun ActorScreen(model: AppModel, a: Screen.Actor) {
    var photo by remember(a.name) { mutableStateOf(a.photo) }
    var known by remember(a.name) { mutableStateOf("") }
    var titles by remember(a.name) { mutableStateOf<List<Meta>?>(null) }
    val first = remember { FocusRequester() }
    LaunchedEffect(a.name) {
        val r = model.person(a.name)
        if (r != null) { if (r.first.isNotEmpty()) photo = r.first; known = r.second; titles = r.third } else titles = emptyList()
    }
    val fade by animateFloatAsState(if (titles == null) 0f else 1f, tween(400, easing = emphasizedEase), label = "actor")
    Box(Modifier.fillMaxSize().background(C.paper)) {
        titles?.firstOrNull()?.let { Img(it.heroImage, Modifier.fillMaxSize().graphicsLayer { alpha = 0.22f * fade }) }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to C.paper.copy(alpha = 0.5f), 0.6f to C.paper)))
        Column(Modifier.fillMaxSize().padding(start = SIDE + 22.dp, top = 56.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(150.dp).clip(CircleShape).background(C.paper3), contentAlignment = Alignment.Center) {
                    Text(a.name.split(" ").mapNotNull { it.firstOrNull()?.uppercase() }.take(2).joinToString(""), style = MaterialTheme.typography.displaySmall, color = C.muted)
                    if (photo.startsWith("https://")) Img(photo, Modifier.fillMaxSize())
                }
                Spacer(Modifier.width(30.dp))
                Column {
                    Text(a.name, style = MaterialTheme.typography.displayLarge, color = C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val line = listOf(known.let { if (it == "Acting") "Actor" else it }, if (a.role.isNotEmpty()) "plays ${a.role}" else "").filter { it.isNotEmpty() }.joinToString("  ·  ")
                    if (line.isNotEmpty()) Text(line, style = MaterialTheme.typography.bodyLarge, color = C.muted, modifier = Modifier.padding(top = 8.dp))
                }
            }
            Spacer(Modifier.height(40.dp))
            SectionTitle("Known for")
            Spacer(Modifier.height(10.dp))
            val list = titles
            when {
                list == null -> Text("Loading…", color = C.muted)
                list.isEmpty() -> Text("Couldn't find their other titles right now.", color = C.muted)
                else -> LazyRow(contentPadding = PaddingValues(start = 8.dp, end = 40.dp, top = 12.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    items(list, key = { it.id }) { m ->
                        Column(Modifier.width(150.dp)) {
                            PosterCard(m, onClick = { model.go(Screen.Title(m)) }, width = 150.dp, modifier = if (m === list.first()) Modifier.focusRequester(first) else Modifier)
                            Text(m.name, style = MaterialTheme.typography.titleSmall, color = C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 10.dp))
                            if (m.releaseInfo.isNotEmpty()) Text(m.releaseInfo, style = MaterialTheme.typography.bodySmall, color = C.muted)
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(titles) { if (titles?.isNotEmpty() == true) repeat(10) { delay(90); try { first.requestFocus(); return@LaunchedEffect } catch (_: Exception) { } } }
}
