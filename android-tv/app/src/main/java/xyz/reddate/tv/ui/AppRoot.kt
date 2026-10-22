package xyz.reddate.tv.ui

import androidx.compose.ui.graphics.graphicsLayer
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** The native screens: one at a time from the model's stack, plus dialogs and a toast. */
@Composable
fun AppRoot(model: AppModel, webShown: Boolean, onExit: () -> Unit) {
    ReddateTheme {
        var lastBack by remember { mutableStateOf(0L) }
        BackHandler(enabled = !webShown) {
            if (model.back()) return@BackHandler
            // On Home: a second Back within two seconds leaves the app, so one stray press doesn't.
            val now = System.currentTimeMillis()
            if (now - lastBack < 2000) onExit() else { lastBack = now; model.say("Press Back again to exit") }
        }
        Box(Modifier.fillMaxSize().background(C.paper)) {
            // Each screen eases in: a short fade with a slight settle, drawn on the GPU layer only (no relayout),
            // so it stays smooth on slow TVs. Nothing waits for it; focus and input work from the first frame.
            // A home with more than one profile starts on "Who's watching?", once per launch.
            var askedWho by remember { mutableStateOf(false) }
            LaunchedEffect(model.info.profiles.size) {
                if (!askedWho && model.info.profiles.size > 1 && model.screen is Screen.Home) { askedWho = true; model.go(Screen.Profiles) }
            }
            val scr = model.screen
            val enter = remember(scr) { androidx.compose.animation.core.Animatable(0f) }
            LaunchedEffect(scr) { enter.animateTo(1f, androidx.compose.animation.core.tween(340, easing = emphasizedEase)) }
            Box(Modifier.fillMaxSize().graphicsLayer {
                alpha = enter.value
                val s = 0.975f + 0.025f * enter.value; scaleX = s; scaleY = s
            }) {
            when (val s = scr) {
                is Screen.Home -> WithRail(model, "home") { HomeScreen(model) }
                is Screen.Search -> WithRail(model, "search") { SearchScreen(model) }
                is Screen.Link -> WithRail(model, "link") { LinkScreen(model) }
                is Screen.Profiles -> ProfilesScreen(model)
                is Screen.Addons -> WithRail(model, "addons") { AddonsScreen(model) }
                is Screen.Account -> WithRail(model, "account") { AccountScreen(model) }
                is Screen.Report -> WithRail(model, "report") { ReportScreen(model) }
                is Screen.Title -> TitleScreen(model, s.meta, s.autoPlay, s.episodeId, s.startAt)
                is Screen.MyList -> WithRail(model, "mylist") { MyListScreen(model) }
                is Screen.Calendar -> WithRail(model, "calendar") { CalendarScreen(model) }
                is Screen.Services -> WithRail(model, "account") { ServicesScreen(model) }
                is Screen.Pick -> PickScreen(model)
                is Screen.Actor -> ActorScreen(model, s)
            }
            }
            // After "Continue watching" finds a stream: its picture stays behind the question and until the player opens.
            model.backdrop?.let { b -> if (!webShown && model.busy == null) PosterBackdrop(b) }
            LaunchedEffect(model.backdrop, model.dialog, model.busy) {
                if (model.backdrop == null || model.busy != null || model.dialog != null) return@LaunchedEffect
                kotlinx.coroutines.delay(if (model.backdropHold) 0 else 2500) // the question appears a moment after the stream is found
                if (model.dialog == null && model.busy == null) {
                    if (model.backdropHold) {
                        var waited = 0
                        while (xyz.reddate.tv.PlayerActivity.current == null && waited < 20_000) { kotlinx.coroutines.delay(200); waited += 200 }
                        kotlinx.coroutines.delay(700)
                    }
                    model.backdrop = null; model.backdropHold = false
                }
            }
            // Dialogs are their own windows, so they must not outlive the native layer being on top.
            if (!webShown) when (val d = model.dialog) {
                is Dlg.WatchChoice -> WatchChoiceDialog(model, d)
                is Dlg.Invite -> InviteDialog(model)
                is Dlg.JoinCode -> JoinCodeDialog(model)
                is Dlg.Together -> TogetherDialog(model)
                is Dlg.RemoveContinue -> RemoveContinueDialog(model, d.item)
                is Dlg.Update -> UpdateDialog(model)
                is Dlg.LeaveToPlay -> LeaveToPlayDialog(model, d)
                is Dlg.AddonNote -> AddonNoteDialog(model, d.note)
                is Dlg.EditProfile -> ProfileDialog(model, d.profile)
                null -> {}
            }
            model.busy?.let { b -> if (!webShown) LoadingOverlay(b) { model.cancelBusy() } }
            model.toast?.let { Toast(it, Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp)) }
        }
    }
}
