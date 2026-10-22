package xyz.reddate.tv.ui

import org.json.JSONArray
import org.json.JSONObject
import xyz.reddate.tv.objects
import xyz.reddate.tv.str

/** A title as a catalog row or the title page knows it. */
data class Meta(
    val id: String,
    val type: String,
    val name: String,
    val poster: String,
    val background: String,
    val description: String,
    val releaseInfo: String,
    val rating: String,
    val genres: List<String> = emptyList(),
    val runtime: String = "",
    val cast: List<String> = emptyList(),
    val imdbId: String = "",
    val trailer: String = "",
    val episodes: List<Episode> = emptyList(),
    val similar: List<Meta> = emptyList(),
    val rank: Int = 0, // 1..10 in a Top 10 row
    val wide: Boolean = false // a video with a wide thumbnail (YouTube): shown as a wide card, never cropped tall
) {
    val isSeries get() = type == "series" || type == "anime" || episodes.isNotEmpty()
    val facts get() = listOf(releaseInfo, runtime, if (rating.isNotEmpty()) "★ $rating" else "").filter { it.isNotEmpty() }.joinToString("  ·  ")
    /** Smaller pictures load faster and use less memory on a TV. */
    val heroImage get() = (background.ifEmpty { poster }).replace("/w1280/", "/w780/").replace("/original/", "/w780/")
}

data class Episode(
    val id: String,
    val title: String,
    val season: Int,
    val number: Int,
    val thumbnail: String,
    val overview: String,
    val rating: String,
    val runtime: String,
    val released: String
) {
    val facts get() = listOf(if (rating.isNotEmpty()) "★ $rating" else "", runtime, released.take(10)).filter { it.isNotEmpty() }.joinToString(" · ")
}

data class Row(val key: String, val title: String, val type: String, val url: String)

/** A Continue watching entry: where you got to in a movie, or which episode of a show is next. */
data class CwItem(val key: String, val id: String, val type: String, val show: String, val name: String, val art: String, val pos: Int, val dur: Int, val next: Boolean) {
    val progress get() = if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else 0f
    val subtitle get() = when {
        next -> "Up next"
        dur > 0 -> "${((dur - pos) / 60).coerceAtLeast(1)} min left"
        else -> "${pos / 60} min in"
    }
}

data class Stream(
    val url: String, val addon: String, val name: String, val title: String, val quality: String, val filename: String,
    val logo: String = "",
    val bitrate: Double = 0.0,      // Mbps, when the addon says
    val match: Int = 0,             // how close to the stream you chose before (higher = closer)
    val matchWhy: String = "",
    val matchExact: Boolean = false, // the memory is for this very show/movie (not just your general taste)
    val usual: Boolean = false       // set per list: only the closest match(es) to the stream you chose before
) {
    /** "The same as last time": the closest match in this list, and close enough to mean it. */
    val remembered get() = usual
}

data class Profile(val id: String, val name: String, val main: Boolean = false)

data class AppInfo(
    val entered: Boolean = false,
    val signedIn: Boolean = false,
    val profile: String = "",
    val profileId: String = "",
    val profiles: List<Profile> = emptyList(),
    val inRoom: Boolean = false,
    val roomCode: String = "",
    val invite: String = "",
    val nowPlaying: String = "",
    val people: List<String> = emptyList(),
    val isGuest: Boolean = false,   // in someone else's watch party (only the host picks what plays)
    val hostName: String = ""
)

private fun httpsOnly(u: String) = when { u.startsWith("https://") -> u; u.startsWith("http://") -> "https://" + u.removePrefix("http://"); else -> "" }

fun parseMeta(o: JSONObject, fallbackType: String = "movie"): Meta {
    val type = o.str("type").ifEmpty { fallbackType }
    val trailer = o.optJSONArray("trailers").objects().firstOrNull()?.str("source") ?: ""
    return Meta(
        id = o.str("id"),
        type = type,
        name = o.str("name").ifEmpty { "Untitled" },
        poster = httpsOnly(o.str("poster").ifEmpty { o.str("background") }.ifEmpty { o.str("logo") }),
        background = httpsOnly(o.str("background")),
        description = o.str("description"),
        releaseInfo = o.str("releaseInfo").ifEmpty { o.str("year") },
        rating = o.str("imdbRating"),
        genres = o.optJSONArray("genres").strings(),
        runtime = o.str("runtime"),
        cast = o.optJSONArray("cast").strings(),
        imdbId = o.str("imdb_id"),
        trailer = trailer,
        wide = o.str("posterShape") == "landscape",
        episodes = o.optJSONArray("videos").objects().map { v ->
            Episode(
                id = v.str("id"),
                title = v.str("title").ifEmpty { v.str("name") }.ifEmpty { "Episode" },
                season = v.optInt("season", 0),
                number = v.optInt("episode", 0),
                thumbnail = httpsOnly(v.str("thumbnail")),
                overview = v.str("overview").ifEmpty { v.str("description") },
                rating = v.str("rating"),
                runtime = v.str("runtime"),
                released = v.str("released")
            )
        }.distinctBy { it.id }.sortedWith(compareBy({ it.season }, { it.number })),
        rank = o.optInt("rank", 0),
        similar = o.optJSONArray("similar").objects().map { parseMeta(it, type) }.filter { it.poster.isNotEmpty() }.distinctBy { it.id }
    )
}

fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it).takeIf { s -> s.isNotEmpty() } }

fun parseInfo(o: JSONObject) = AppInfo(
    entered = o.optBoolean("entered"),
    signedIn = o.optBoolean("signedIn"),
    profile = o.str("profile"),
    profileId = o.str("profileId"),
    profiles = o.optJSONArray("profiles").objects().map { Profile(it.str("id"), it.str("name"), it.optBoolean("main")) },
    inRoom = o.optBoolean("inRoom"),
    roomCode = o.str("roomCode"),
    invite = o.str("invite"),
    nowPlaying = o.str("nowPlaying"),
    people = o.optJSONArray("people").strings(),
    isGuest = o.optBoolean("isGuest"),
    hostName = o.str("hostName")
)

/** A title as saved in My List: just what a poster and the details need. */
fun metaToJson(m: Meta): JSONObject = JSONObject()
    .put("id", m.id).put("type", m.type).put("name", m.name).put("poster", m.poster).put("background", m.background)
    .put("description", m.description).put("releaseInfo", m.releaseInfo).put("imdbRating", m.rating)
    .put("runtime", m.runtime).put("genres", JSONArray(m.genres))
fun metaFromJson(o: JSONObject): Meta = parseMeta(o)
