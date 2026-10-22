package xyz.reddate.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import org.json.JSONObject
import xyz.reddate.tv.Engine
import xyz.reddate.tv.objects
import xyz.reddate.tv.str

private class CalEntry(val meta: Meta, val date: String, val note: String)

/** What is coming out: films in cinemas, films arriving digitally (VOD, rent, buy), and new TV episodes, for this TV's country. */
@Composable
fun CalendarScreen(model: AppModel) {
    var data by remember { mutableStateOf<Map<String, List<CalEntry>>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf("cinema") }
    // Worldwide by default (the popular releases anywhere); one press narrows it to this TV's country.
    var worldwide by remember { mutableStateOf(true) }
    val first = remember { FocusRequester() }
    val country = remember { java.util.Locale.getDefault().country.ifEmpty { "US" } }
    LaunchedEffect(worldwide) {
        data = null; failed = false
        try {
            val o = Engine.call("calendar", JSONObject().put("region", if (worldwide) "WW" else country), 45_000) as JSONObject
            data = listOf("cinema", "digital", "tv").associateWith { k ->
                o.optJSONArray(k).objects().map { CalEntry(parseMeta(it, if (k == "tv") "series" else "movie"), it.str("calDate"), it.str("calNote")) }
            }
        } catch (_: Exception) { failed = true }
    }
    LaunchedEffect(Unit) { repeat(10) { delay(90); try { first.requestFocus(); return@LaunchedEffect } catch (_: Exception) { } } }

    val today = remember { java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date()) }
    val tomorrow = remember { java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date(System.currentTimeMillis() + 86_400_000L)) }
    fun label(d: String): String {
        if (d == today) return "Today"
        if (d == tomorrow) return "Tomorrow"
        return try {
            java.text.SimpleDateFormat("EEEE, MMMM d", java.util.Locale.getDefault()).format(java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(d)!!)
        } catch (_: Exception) { d }
    }

    Column(Modifier.fillMaxSize().padding(start = LocalRailInset.current + 22.dp, end = SIDE + 22.dp, top = 36.dp)) {
        Text("Calendar", style = MaterialTheme.typography.displayMedium, color = C.ink)
        Text(if (worldwide) "The most popular releases coming out around the world" else "The most popular releases coming out in $country", style = MaterialTheme.typography.bodyLarge, color = C.muted, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            for ((key, name) in listOf("cinema" to "In cinemas", "digital" to "Digital and VOD", "tv" to "TV and streaming")) {
                val n = data?.get(key)?.size
                PillButton(if (n != null) "$name · $n" else name, { tab = key }, primary = tab == key, modifier = if (key == "cinema") Modifier.focusRequester(first) else Modifier)
            }
            PillButton(if (worldwide) "Worldwide" else "Only $country", { worldwide = !worldwide })
        }
        Spacer(Modifier.height(14.dp))
        val list = data?.get(tab)
        when {
            failed -> Text("The calendar isn't available right now. Try again in a moment.", style = MaterialTheme.typography.bodyLarge, color = C.ink)
            list == null -> Text("Loading…", style = MaterialTheme.typography.bodyLarge, color = C.muted)
            list.isEmpty() -> Text("Nothing listed for this country in the next weeks.", style = MaterialTheme.typography.bodyLarge, color = C.ink)
            else -> {
                val groups = list.groupBy { it.date }.toSortedMap().entries.toList()
                LazyColumn(contentPadding = PaddingValues(bottom = 60.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                    items(groups, key = { tab + it.key }) { g ->
                        Column {
                            Text(label(g.key), style = MaterialTheme.typography.titleLarge, color = C.ink, modifier = Modifier.padding(bottom = 10.dp))
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(horizontal = 4.dp)) {
                                items(g.value, key = { it.meta.id }) { e ->
                                    Column(Modifier.width(150.dp)) {
                                        Box {
                                            PosterCard(e.meta, onClick = { model.go(Screen.Title(e.meta)) }, width = 150.dp)
                                            DateLeaf(e.date, Modifier.align(Alignment.TopStart).padding(8.dp))
                                        }
                                        Text(e.meta.name, style = MaterialTheme.typography.titleSmall, color = C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 10.dp).width(150.dp))
                                        Text(e.note, style = MaterialTheme.typography.bodySmall, color = C.muted, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(150.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A small calendar page on the poster: the month over the day. */
@Composable
private fun DateLeaf(date: String, modifier: Modifier = Modifier) {
    val parts = date.split("-")
    if (parts.size != 3) return
    val month = try { java.text.SimpleDateFormat("MMM", java.util.Locale.getDefault()).format(java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(date)!!).uppercase() } catch (_: Exception) { "" }
    Column(modifier.background(C.paper.copy(alpha = 0.92f), RoundedCornerShape(8.dp)).padding(horizontal = 9.dp, vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(month, style = MaterialTheme.typography.labelSmall, color = C.accent, textAlign = TextAlign.Center)
        Text(parts[2].trimStart('0').ifEmpty { "0" }, style = MaterialTheme.typography.titleMedium, color = C.ink, textAlign = TextAlign.Center)
    }
}
