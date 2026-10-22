package xyz.reddate.tv.ui

import androidx.compose.foundation.BorderStroke
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import xyz.reddate.tv.Engine
import xyz.reddate.tv.objects
import xyz.reddate.tv.str

data class AddonItem(
    val url: String, val name: String, val host: String, val logo: String, val description: String,
    val enabled: Boolean, val loaded: Boolean, val catalog: Boolean, val stream: Boolean, val subtitles: Boolean,
    val rows: Int = 0
)

private fun parseAddon(o: JSONObject) = AddonItem(
    o.str("url"), o.str("name"), o.str("host"), o.str("logo"), o.str("description"),
    o.optBoolean("enabled", true), o.optBoolean("loaded"), o.optBoolean("catalog"), o.optBoolean("stream"), o.optBoolean("subtitles"),
    o.optInt("rows")
)

/** A dark card for the right-hand column. */
@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.paper2).padding(20.dp)) { content() }
}

@Composable
private fun Qr(url: String, size: Int = 150) {
    val bmp = remember(url) { qrBitmap(url, 360) }
    if (bmp != null) Box(Modifier.size(size.dp).clip(RoundedCornerShape(10.dp)).background(Color.White).padding(8.dp)) {
        Image(bmp.asImageBitmap(), contentDescription = "QR code", modifier = Modifier.fillMaxSize())
    }
}

/** One focusable line in a list: the whole row is the button. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ListRow(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.015f),
        colors = ClickableSurfaceDefaults.colors(containerColor = C.paper2, focusedContainerColor = Color(0xFF3A322E), contentColor = C.ink, focusedContentColor = C.ink),
        border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(2.dp, C.ink), shape = RoundedCornerShape(14.dp)))
    ) { content() }
}

@Composable
private fun Logo(name: String, logo: String, size: Int = 44) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape(10.dp)).background(C.paper3), contentAlignment = Alignment.Center) {
        // Reddate's own addons wear the Reddate mark; others show their logo, or their first letter.
        if (name.startsWith("Reddate")) RedMark((size * 0.62f).dp)
        else Text(name.trim().take(1).uppercase().ifEmpty { "?" }, color = C.muted, style = MaterialTheme.typography.titleMedium)
        if (logo.startsWith("https://")) AsyncImage(model = logo, contentDescription = null, contentScale = androidx.compose.ui.layout.ContentScale.Fit, modifier = Modifier.fillMaxSize().background(C.paper3).padding(4.dp))
    }
}

/** Addons, like the old page: Your addons (grouped by what they do), Home rows (show, hide, order) and New addon. */
@Composable
fun AddonsScreen(model: AppModel) {
    var items by remember { mutableStateOf<List<AddonItem>?>(null) }
    var suggested by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var homeRows by remember { mutableStateOf<List<Triple<String, String, Boolean>>?>(null) } // key, title, shown
    var tab by remember { mutableStateOf(0) } // 0 addons, 1 home rows, 2 new addon
    var link by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var armed by remember { mutableStateOf("") } // remove needs a second press
    var lastMsg by remember { mutableStateOf("") }
    var syncing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    val site = remember { mutableStateOf("") }
    var ytHover by remember { mutableStateOf(false) } // the Reddate YT placeholder is focused: its card shows the phone QR

    suspend fun reload() {
        items = try { (Engine.call("addons") as? JSONArray).objects().map(::parseAddon) } catch (_: Exception) { items ?: emptyList() }
        suggested = try { (Engine.call("addonSuggested") as? JSONArray).objects() } catch (_: Exception) { emptyList() }
        homeRows = try { (Engine.call("homeRows") as? JSONArray).objects().map { Triple(it.str("key"), it.str("title"), it.optBoolean("visible", true)) } } catch (_: Exception) { homeRows ?: emptyList() }
    }
    LaunchedEffect(Unit) {
        site.value = try { (Engine.call("accountInfo") as? JSONObject)?.str("site") ?: "" } catch (_: Exception) { "" }
        reload()
        delay(100)
        try { first.requestFocus() } catch (_: Exception) { }
    }
    // Added on the phone meanwhile: the list keeps itself current.
    LaunchedEffect(model.rowsVersion) { if (items != null) reload() }
    LaunchedEffect(armed) { if (armed.isNotEmpty()) { delay(3500); armed = "" } }

    fun add() {
        val u = link.trim()
        if (u.isEmpty() || busy) return
        busy = true
        lastMsg = "Checking the addon…"
        scope.launch {
            val r = try { Engine.call("addonAdd", JSONObject().put("url", u)) as? JSONObject } catch (e: Exception) { JSONObject().put("ok", false).put("message", e.message ?: "Couldn't add it") }
            val msg = r?.str("message")?.ifEmpty { null } ?: r?.str("error")?.ifEmpty { null } ?: if (r?.optBoolean("ok") == true) "Added" else "Couldn't add that link"
            lastMsg = msg
            model.say(msg)
            if (r?.optBoolean("ok") == true) { link = ""; tab = 0 }
            reload(); busy = false
        }
    }
    // "Sync": ask the account for anything added on the phone and load it now.
    // Opening this screen asks your account for anything added on the phone, quietly: no button, no message
    // (the list also updates by itself while you're here).
    LaunchedEffect(Unit) {
        try { Engine.call("syncAddons", timeoutMs = 60_000) } catch (_: Exception) { }
        reload()
    }
    fun saveRows(l: List<Triple<String, String, Boolean>>) {
        homeRows = l
        scope.launch {
            try { Engine.call("setHomeRows", JSONObject().put("rows", JSONArray().apply { l.forEach { put(JSONObject().put("key", it.first).put("title", it.second).put("visible", it.third)) } })) } catch (_: Exception) { }
        }
    }

    Row(Modifier.fillMaxSize().background(C.paper).padding(start = LocalRailInset.current + 28.dp, end = 40.dp, top = 32.dp)) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Addons", style = MaterialTheme.typography.displaySmall, color = C.ink)
            }
            Spacer(Modifier.height(12.dp))
            val list = items
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("Your addons" + (list?.size?.let { " · $it" } ?: ""), "Home rows" + (homeRows?.size?.takeIf { it > 0 }?.let { " · $it" } ?: ""), "New addon").forEachIndexed { i, label ->
                    Surface(
                        onClick = { tab = i },
                        modifier = Modifier.onFocusChanged { if (it.isFocused) tab = i }.then(if (i == 0) Modifier.focusRequester(first) else Modifier),
                        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(50)),
                        colors = ClickableSurfaceDefaults.colors(
                            containerColor = if (tab == i) C.paper3 else C.paper2, contentColor = if (tab == i) C.ink else C.muted,
                            focusedContainerColor = C.ink, focusedContentColor = C.paper
                        ),
                        border = ClickableSurfaceDefaults.border(border = if (tab == i) Border(BorderStroke(2.dp, C.accent), shape = RoundedCornerShape(50)) else Border.None)
                    ) { Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
                }
            }
            Spacer(Modifier.height(14.dp))
            when (tab) {
                0 -> {
                    if (list == null) Text("Loading your addons…", color = C.muted)
                    else LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 120.dp)) {
                        val broken = list.filter { !it.loaded }
                        if (broken.size >= 2) item(key = "broken") {
                            PillButton("Remove the ${broken.size} that couldn't load", {
                                scope.launch {
                                    try { Engine.call("addonRemoveMany", JSONObject().put("urls", JSONArray(broken.map { it.url }))) } catch (_: Exception) { }
                                    model.say("Removed ${broken.size} addons")
                                    reload()
                                }
                            }, icon = Icons.Default.Delete)
                        }
                        val sections = listOf(
                            Triple("Catalogs", "They decide what Home shows.", list.filter { it.catalog }),
                            Triple("Stream sources", "Where videos come from when you press Play.", list.filter { it.stream }),
                            Triple("Subtitles", "", list.filter { it.subtitles && !it.catalog && !it.stream }),
                            Triple("Other", "", list.filter { !it.catalog && !it.stream && !it.subtitles })
                        )
                        sections.forEach { (title, sub, group) ->
                            if (group.isEmpty()) return@forEach
                            item(key = "h:$title") {
                                Column(Modifier.padding(top = 6.dp)) {
                                    Text("$title  ·  ${group.size}", style = MaterialTheme.typography.titleMedium, color = C.ink)
                                    if (sub.isNotEmpty()) Text(sub, color = C.muted, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            items(group, key = { "$title|${it.url}" }) { a -> AddonRow(a, armed, { armed = it }, scope, model, { ytHover = it }) { scope.launch { reload() } } }
                        }
                    }
                }
                1 -> {
                    val rows = homeRows
                    if (rows == null) Text("Loading…", color = C.muted)
                    else if (rows.isEmpty()) Text("Add a catalog addon to get rows on Home.", color = C.muted)
                    else {
                        Text("Choose which rows Home shows and in what order. The first shown row sets the big banner.", color = C.muted, style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(10.dp))
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 120.dp)) {
                            items(rows.size, key = { rows[it].first }) { i ->
                                val r = rows[i]
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    ListRow({ saveRows(rows.toMutableList().also { it[i] = r.copy(third = !r.third) }) }, Modifier.weight(1f)) {
                                        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Text(r.second, style = MaterialTheme.typography.titleMedium, color = if (r.third) C.ink else C.muted, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                            Box(Modifier.clip(RoundedCornerShape(50)).background(if (r.third) C.accent else C.paper3).padding(horizontal = 12.dp, vertical = 4.dp)) {
                                                Text(if (r.third) "Shown" else "Hidden", color = if (r.third) C.accentInk else C.muted, style = MaterialTheme.typography.labelLarge)
                                            }
                                        }
                                    }
                                    Spacer(Modifier.width(8.dp))
                                    PillButton("Up", { if (i > 0) saveRows(rows.toMutableList().also { val t = it[i]; it[i] = it[i - 1]; it[i - 1] = t }) })
                                    Spacer(Modifier.width(6.dp))
                                    PillButton("Down", { if (i < rows.size - 1) saveRows(rows.toMutableList().also { val t = it[i]; it[i] = it[i + 1]; it[i + 1] = t }) })
                                }
                            }
                        }
                    }
                }
                else -> {
                    Text("Paste a Stremio or Nuvio addon link (it ends in manifest.json). Reddate works out whether it adds rows to Home, streams to play, or subtitles.", color = C.muted, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(12.dp))
                    TvTextField(link, { link = it }, "https://…/manifest.json", ::add, Modifier.fillMaxWidth(), url = true)
                    Spacer(Modifier.height(10.dp))
                    PillButton(if (busy) "Adding…" else "Add this addon", ::add, primary = true, icon = Icons.Default.Add)
                    if (lastMsg.isNotEmpty()) Text(lastMsg, color = C.ink, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 12.dp))
                    if (suggested.isNotEmpty()) {
                        Spacer(Modifier.height(16.dp))
                        SectionTitle("Suggested")
                        suggested.forEach { sg ->
                            val sgYt = isYtSetup(sg.str("url"))
                            ListRow({
                                if (sgYt) { model.say("Scan from your phone to activate Reddate YT"); return@ListRow }
                                scope.launch {
                                    try { Engine.call("addonRestore", JSONObject().put("url", sg.str("url"))) } catch (_: Exception) { }
                                    model.say("Added ${sg.str("name")}")
                                    reload()
                                }
                            }, Modifier.fillMaxWidth().padding(bottom = 8.dp).then(if (sgYt) Modifier.onFocusChanged { ytHover = it.isFocused } else Modifier)) {
                                Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Default.Add, contentDescription = null, tint = C.accent)
                                    Spacer(Modifier.width(12.dp))
                                    Column {
                                        Text(sg.str("name"), style = MaterialTheme.typography.titleMedium)
                                        if (sg.str("description").isNotEmpty()) Text(sg.str("description"), color = C.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.width(28.dp))
        Column(Modifier.width(330.dp)) {
            Spacer(Modifier.height(64.dp))
            Card {
                if (ytHover) {
                    Text("Scan from your phone to activate this add on", style = MaterialTheme.typography.titleMedium, color = C.ink)
                    Spacer(Modifier.height(4.dp))
                    Text("Reddate YT can't be turned on from the TV yet. Set it up on your phone and it shows up here.", color = C.muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(14.dp))
                    if (site.value.isNotEmpty()) Qr("${site.value}/addon-list#yt")
                } else {
                    Text("Add from your phone", style = MaterialTheme.typography.titleMedium, color = C.ink)
                    Spacer(Modifier.height(4.dp))
                    Text("Scan, paste the addon link there, and it shows up here in a few seconds.", color = C.muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(14.dp))
                    if (site.value.isNotEmpty()) Qr("${site.value}/?open=addons")
                }
            }
        }
    }
}

/** Reddate YT before anyone has made their own link: a placeholder on the TV (it is set up on a phone). */
private fun isYtSetup(url: String) = url.endsWith("/yt/manifest.json")

/** One addon: its logo, name and what it does; OK turns it on or off, and Remove takes it away (press twice). */
@Composable
private fun AddonRow(a: AddonItem, armed: String, setArmed: (String) -> Unit, scope: kotlinx.coroutines.CoroutineScope, model: AppModel, onYtHover: (Boolean) -> Unit, reload: () -> Unit) {
    val yt = isYtSetup(a.url)
    Row(verticalAlignment = Alignment.CenterVertically) {
        ListRow({
            if (yt) { model.say("Scan from your phone to activate Reddate YT"); return@ListRow }
            scope.launch {
                try { Engine.call("addonEnable", JSONObject().put("url", a.url).put("on", !a.enabled)) } catch (_: Exception) { }
                model.say(if (a.enabled) "${a.name} is off" else "${a.name} is on")
                reload()
            }
        }, Modifier.weight(1f).then(if (yt) Modifier.onFocusChanged { onYtHover(it.isFocused) } else Modifier)) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Logo(a.name, a.logo)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (a.loaded) a.name else "Couldn't load this addon", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = if (a.enabled) C.ink else C.muted)
                    val kinds = listOfNotNull(
                        if (a.catalog) (if (a.rows > 0) "Catalog · ${a.rows} ${if (a.rows == 1) "row" else "rows"}" else "Catalog") else null,
                        if (a.stream) "Streams" else null, if (a.subtitles) "Subtitles" else null
                    )
                    Text((kinds + a.host).filter { it.isNotEmpty() }.joinToString("  ·  "), color = C.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.width(10.dp))
                Box(Modifier.clip(RoundedCornerShape(50)).background(if (a.enabled && !yt) C.accent else C.paper3).padding(horizontal = 12.dp, vertical = 4.dp)) {
                    Text(if (yt) "Set up on phone" else if (a.enabled) "On" else "Off", color = if (a.enabled && !yt) C.accentInk else C.muted, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
        Spacer(Modifier.width(10.dp))
        PillButton(if (armed == a.url) "Press again" else "Remove", {
            if (armed != a.url) { setArmed(a.url); return@PillButton }
            setArmed("")
            scope.launch {
                try { Engine.call("addonRemove", JSONObject().put("url", a.url)) } catch (_: Exception) { }
                model.say("Removed ${a.name}")
                reload()
            }
        }, icon = Icons.Default.Delete)
    }
}

/** Account: who you are, confirm your email, switch profile, sign out; the rest on the phone. */
@Composable
fun AccountScreen(model: AppModel) {
    var acct by remember { mutableStateOf<JSONObject?>(null) }
    var resent by remember { mutableStateOf("") }
    var armed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        acct = try { Engine.call("accountInfo") as? JSONObject } catch (_: Exception) { JSONObject() }
        delay(100)
        try { first.requestFocus() } catch (_: Exception) { }
    }
    LaunchedEffect(armed) { if (armed) { delay(3500); armed = false } }
    val a = acct ?: JSONObject()
    val name = a.str("profile").ifEmpty { model.info.profile }
    Row(Modifier.fillMaxSize().background(C.paper).padding(start = LocalRailInset.current + 28.dp, end = 40.dp, top = 32.dp)) {
        // Scrolls, so everything stays reachable however much is on the page (the unconfirmed-email card adds height).
        Column(Modifier.weight(1f).verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(top = 8.dp, bottom = 40.dp)) {
            Text("Account", style = MaterialTheme.typography.displaySmall, color = C.ink)
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(name.ifEmpty { "?" }, 64.dp)
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(name, style = MaterialTheme.typography.headlineSmall, color = C.ink)
                    Text(a.str("email"), color = C.muted, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(14.dp))
            if (acct != null && !a.optBoolean("verified", true)) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0x33E8602C)).padding(16.dp)) {
                    Text("Confirm your email", style = MaterialTheme.typography.titleMedium, color = C.ink)
                    Text(resent.ifEmpty { "So you can reset your password if you ever forget it. The link is in your inbox (or spam)." }, color = C.muted, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(10.dp))
                    PillButton("Send the link again", {
                        scope.launch {
                            val r = try { Engine.call("resendConfirm") as? JSONObject } catch (_: Exception) { null }
                            resent = when { r?.optBoolean("verified") == true -> "Already confirmed. Thanks!"; r?.optBoolean("ok") == true -> "Sent. Check your inbox (and spam)."; else -> r?.str("error")?.ifEmpty { null } ?: "Couldn't send it. Try again later." }
                        }
                    })
                }
                Spacer(Modifier.height(16.dp))
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.width(460.dp)) {
                ListRow({ model.go(Screen.Profiles) }, Modifier.fillMaxWidth().focusRequester(first)) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Text("Switch profile", style = MaterialTheme.typography.titleMedium)
                        Text("${a.optInt("profiles", model.info.profiles.size)} on this account", color = C.muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                ListRow({ model.go(Screen.Addons) }, Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Text("Addons", style = MaterialTheme.typography.titleMedium)
                        Text("Turn them on or off, remove or add", color = C.muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                ListRow({ model.go(Screen.Services) }, Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Text("Watch trackers", style = MaterialTheme.typography.titleMedium)
                        Text("Trakt, WeTrakr, Simkl: keep your history in step", color = C.muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                ListRow({ model.dialog = Dlg.Update }, Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Text(if (model.update != null) "Update available" else "Updates", style = MaterialTheme.typography.titleMedium, color = if (model.update != null) C.accent else C.ink)
                        Text("Reddate TV ${xyz.reddate.tv.BuildConfig.VERSION_NAME}", color = C.muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                ListRow({ model.go(Screen.Report) }, Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Text("Report a bug", style = MaterialTheme.typography.titleMedium)
                        Text("Tell us what went wrong; it sends this TV's details", color = C.muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                ListRow({
                    if (!armed) { armed = true; return@ListRow }
                    scope.launch {
                        try { Engine.call("signOut") } catch (_: Exception) { }
                        model.say("Signed out")
                    }
                }, Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Text(if (armed) "Press again to sign out" else "Sign out of this TV", style = MaterialTheme.typography.titleMedium, color = if (armed) C.accent else C.ink)
                        Text(a.str("device").takeUnless { it.isEmpty() || it.startsWith("Chrome") } ?: "${android.os.Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${android.os.Build.MODEL}", color = C.muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Text("Reddate TV ${xyz.reddate.tv.BuildConfig.VERSION_NAME}", color = C.muted, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.width(28.dp))
        Column(Modifier.width(330.dp)) {
            Spacer(Modifier.height(64.dp))
            Card {
                Text("On your phone", style = MaterialTheme.typography.titleMedium, color = C.ink)
                Spacer(Modifier.height(4.dp))
                Text("Add or rename profiles, see your devices, change your password or delete the account. Typing is easier there.", color = C.muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(14.dp))
                val site = a.str("site")
                if (site.isNotEmpty()) Qr("$site/?open=account")
            }
        }
    }
}


/** Report a bug: type it here, or scan the code and send a picture and text from a phone. It reaches us by email. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ReportScreen(model: AppModel) {
    var info by remember { mutableStateOf<JSONObject?>(null) }
    var text by remember { mutableStateOf("") }
    var state by remember { mutableStateOf("") } // "", "sending", "sent", or an error message
    val scope = rememberCoroutineScope()
    val box = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        info = try { Engine.call("accountInfo") as? JSONObject } catch (_: Exception) { JSONObject() }
        delay(150)
        try { box.requestFocus() } catch (_: Exception) { }
    }
    val a = info ?: JSONObject()
    val site = a.str("site")
    val device = "${android.os.Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${android.os.Build.MODEL}"
    val version = xyz.reddate.tv.BuildConfig.VERSION_NAME
    fun send() {
        if (text.trim().length < 5) { state = "Tell us a little more about what went wrong."; return }
        val base = info?.str("site").orEmpty()
        if (state == "sending") return
        if (base.isEmpty()) { state = "Couldn't reach the server. Try again in a moment."; return }
        state = "sending"
        val body = JSONObject().put("message", text.trim()).put("source", "tv").put("app", version).put("device", device)
            .put("account", info?.str("email").orEmpty()).put("screen", "Account")
        scope.launch {
            state = withContext(Dispatchers.IO) {
                try {
                    val c = java.net.URL("$base/api/report").openConnection() as java.net.HttpURLConnection
                    c.requestMethod = "POST"; c.connectTimeout = 10000; c.readTimeout = 20000; c.doOutput = true
                    c.setRequestProperty("Content-Type", "application/json")
                    c.outputStream.use { it.write(body.toString().toByteArray()) }
                    if (c.responseCode in 200..299) "sent"
                    else (try { JSONObject(c.errorStream.bufferedReader().readText()).optString("error") } catch (_: Exception) { "" }).ifEmpty { "Couldn't send it. Try again in a moment." }
                } catch (_: Exception) { "Couldn't reach the server. Check the connection and try again." }
            }
            if (state == "sent") text = ""
        }
    }
    Row(Modifier.fillMaxSize().background(C.paper).padding(start = LocalRailInset.current + 28.dp, end = 40.dp, top = 32.dp)) {
        Column(Modifier.weight(1f)) {
            Text("Report a bug", style = MaterialTheme.typography.displaySmall, color = C.ink)
            Spacer(Modifier.height(8.dp))
            Text("What happened? Which title or screen, and what you expected.", color = C.muted, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(18.dp))
            TvTextField(text, { text = it; if (state == "sent") state = "" }, "Type here, then press Send", { send() }, Modifier.fillMaxWidth().focusRequester(box))
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                PillButton(if (state == "sending") "Sending…" else "Send report", { send() }, primary = true)
                Spacer(Modifier.width(16.dp))
                val msg = when (state) { "" , "sending" -> ""; "sent" -> "Sent. Thank you, this really helps."; else -> state }
                if (msg.isNotEmpty()) Text(msg, color = if (state == "sent") C.ink else C.accent, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(14.dp))
            Text("We receive your message, the app version ($version) and this TV's model.", color = C.muted, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.width(28.dp))
        Column(Modifier.width(330.dp)) {
            Spacer(Modifier.height(64.dp))
            Card {
                Text("Have a screenshot?", style = MaterialTheme.typography.titleMedium, color = C.ink)
                Spacer(Modifier.height(4.dp))
                Text("Scan this with your phone to send text and pictures. Typing is easier there too.", color = C.muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(14.dp))
                if (site.isNotEmpty()) {
                    val q = "?s=tv&v=" + java.net.URLEncoder.encode(version, "UTF-8") + "&d=" + java.net.URLEncoder.encode(device, "UTF-8")
                    Qr("$site/report$q")
                    Spacer(Modifier.height(8.dp))
                    Text(site.removePrefix("https://").removePrefix("http://") + "/report", color = C.muted, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}


/** Watch trackers (Trakt, WeTrakr, Simkl): connect with a code typed at the tracker's own page, then what you play is reported. */
@Composable
fun ServicesScreen(model: AppModel) {
    val scope = rememberCoroutineScope()
    var services by remember { mutableStateOf<List<JSONObject>?>(null) }
    var failed by remember { mutableStateOf("") }
    // The tracker being connected right now, with the code to type.
    var connecting by remember { mutableStateOf<Pair<String, JSONObject>?>(null) }
    val first = remember { FocusRequester() }
    fun load() { scope.launch { try { services = (Engine.call("trackers") as? JSONArray).objects(); failed = "" } catch (e: Exception) { failed = e.message ?: "Couldn't load." } } }
    LaunchedEffect(Unit) { load() }
    LaunchedEffect(services) { if (services != null) repeat(10) { delay(90); try { first.requestFocus(); return@LaunchedEffect } catch (_: Exception) { } } }
    // While a code is on screen, ask the tracker every few seconds whether it was entered.
    LaunchedEffect(connecting) {
        val (svc, code) = connecting ?: return@LaunchedEffect
        val every = (code.optInt("interval", 5).coerceIn(2, 15)) * 1000L
        val until = System.currentTimeMillis() + code.optInt("expiresIn", 600) * 1000L
        while (System.currentTimeMillis() < until) {
            delay(every)
            val st = try { (Engine.call("trackerPoll", JSONObject().put("svc", svc)) as JSONObject).str("status") } catch (_: Exception) { "pending" }
            if (st == "connected") { model.say("Connected"); connecting = null; load(); return@LaunchedEffect }
            if (st == "expired" || st == "denied" || st == "none") { model.say(if (st == "denied") "That was declined" else "The code ran out. Try again."); connecting = null; return@LaunchedEffect }
        }
        connecting = null
    }
    Column(Modifier.fillMaxSize().padding(start = LocalRailInset.current + 22.dp, end = 60.dp, top = 36.dp)) {
        Text("Watch trackers", style = MaterialTheme.typography.displayMedium, color = C.ink)
        Text("Connect a tracker and Reddate tells it what you start, pause and finish.", style = MaterialTheme.typography.bodyLarge, color = C.muted, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(22.dp))
        val list = services
        when {
            failed.isNotEmpty() && list == null -> Text(if (failed.contains("Sign in", true)) "Sign in to your Reddate account to connect a tracker." else failed, style = MaterialTheme.typography.bodyLarge, color = C.ink)
            list == null -> Text("Loading…", style = MaterialTheme.typography.bodyLarge, color = C.muted)
            else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.width(720.dp)) {
                list.forEachIndexed { i, sv ->
                    val id = sv.str("id"); val name = sv.str("name")
                    val available = sv.optBoolean("available"); val on = sv.optBoolean("connected"); val reporting = sv.optBoolean("scrobble")
                    val code = connecting?.takeIf { it.first == id }?.second
                    Column(Modifier.fillMaxWidth().background(C.paper2, RoundedCornerShape(16.dp)).padding(18.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(name, style = MaterialTheme.typography.titleLarge, color = C.ink)
                                Text(when { !available -> "Not available yet"; sv.optBoolean("expired") -> "Sign-in expired, connect again"; on -> if (reporting) "Connected · reporting what you watch" else "Connected · reporting is off"; else -> "Not connected" },
                                    style = MaterialTheme.typography.bodyMedium, color = if (on) C.accent else C.muted)
                            }
                            if (available && !on && code == null) PillButton("Connect", {
                                scope.launch { try { connecting = id to (Engine.call("trackerConnect", JSONObject().put("svc", id)) as JSONObject) } catch (e: Exception) { model.say(e.message ?: "Couldn't start that") } }
                            }, primary = true, modifier = if (i == 0) Modifier.focusRequester(first) else Modifier)
                            if (on) {
                                PillButton(if (reporting) "Reporting: On" else "Reporting: Off", {
                                    scope.launch { try { Engine.call("trackerScrobble", JSONObject().put("svc", id).put("on", !reporting)); load() } catch (_: Exception) { } }
                                }, modifier = if (i == 0) Modifier.focusRequester(first) else Modifier)
                                Spacer(Modifier.width(10.dp))
                                PillButton("Disconnect", { scope.launch { try { Engine.call("trackerDisconnect", JSONObject().put("svc", id)); model.say("Disconnected"); load() } catch (_: Exception) { } } })
                            }
                        }
                        if (code != null) {
                            Spacer(Modifier.height(14.dp))
                            Text("On your phone or computer, open", style = MaterialTheme.typography.bodyMedium, color = C.muted)
                            Text(code.str("url").replace(Regex("^https?://"), ""), style = MaterialTheme.typography.titleMedium, color = C.ink)
                            Text("and type this code", style = MaterialTheme.typography.bodyMedium, color = C.muted, modifier = Modifier.padding(top = 8.dp))
                            Text(code.str("userCode"), style = MaterialTheme.typography.displayMedium, color = C.accent)
                            Spacer(Modifier.height(10.dp))
                            PillButton("Cancel", { connecting = null }, modifier = Modifier.focusRequester(first))
                        }
                    }
                }
            }
        }
    }
}
