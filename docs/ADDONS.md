# Addons

Reddate speaks the [Stremio addon protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md),
the same format Nuvio uses, so existing addons work as-is:

1. In a room, click **🍿 Browse movies & shows** → **🧩 Addons** and paste an
   addon's `manifest.json` URL.
2. **Catalog** addons add rows to browse and search. Cinemeta is built in, so
   browsing works before you add anything; other catalog addons add more.
3. **Stream** addons turn a title or episode into playable links. Reddate ships
   none — to play anything, someone in the room pastes their own stream addon.
   Pick a stream and it loads for the whole room through the normal synced player.

How it fits together:

- **The browser talks to addons directly.** Stremio addons serve
  `Access-Control-Allow-Origin: *`, so the server never proxies them.
- **The room's addon list is shared with everyone in the room.** Addon URLs often
  contain personal auth tokens, so only add ones you're happy to share with the
  people there. The server keeps the list in memory only while the room exists
  (so late joiners receive it), and never logs it.
- **Only streams that actually play are listed.** What a browser can decode
  depends on the browser: Safari and Chrome on Mac handle HEVC, Chrome opens many
  MKVs, and Chrome/Firefox can't decode Dolby (AC-3 / E-AC-3 "DDP") audio, so
  those files play silently. Stream titles can't tell you that, so Reddate
  test-plays each stream for a few seconds in a hidden, muted player and lists
  only the ones whose video **and** audio decode (stopping once it finds 5).
  Checks pause while the tab is hidden, since browsers won't play media there.
  Files whose container or codecs this browser reports it can't decode (from the
  MKV header, e.g. MKV on iPhone or Dolby audio in Chrome) are skipped without
  downloading, and the search stops after 45 seconds — if nothing was confirmed
  by then (or the phone blocks test playback, e.g. in Low Power Mode), the best
  remaining candidates are shown to try.
  Torrent/magnet-only results, streams needing custom request headers, and
  30 GB+ remuxes are skipped. HLS (`.m3u8`) plays via hls.js.
- The room's addon list is also remembered in your browser (on your device only),
  so refreshing while you're alone in a room doesn't lose it.
- **Badges** — each stream shows what its release name says: resolution,
  streaming service (Netflix, Prime Video, Disney+…), Dolby Vision / HDR,
  source (REMUX, Blu-ray, WEB-DL, and a red CAM warning), audio (Atmos, DD+,
  DTS-HD, AAC, 5.1…), codec and edition. Logos are public-domain files linked
  from Wikimedia Commons (so viewers' browsers load them from Wikimedia);
  everything else is a Reddate-styled badge.

### Subtitles & audio tracks

Both are **per viewer** — each person picks their own; nothing is synced.

- **💬 Subtitles** — for titles picked from Browse, subtitles come from the
  built-in OpenSubtitles v3 addon plus any room addon that offers subtitles.
  Pick a language and a file (ones matching the stream's release are ranked
  first, early CAM/TS rips last), nudge timing ±0.5s if they drift, or load
  your own `.srt`/`.vtt` file for any video. Your language is remembered and
  applied automatically to the next title.
- **🔊 Audio** — switch between a file's audio tracks (e.g. Hindi / English).
  Browsers limit this: Safari supports it for regular files and every browser
  supports it for HLS streams, but Chrome and Firefox can't switch the audio
  of a regular MP4/MKV file. The button only appears when switching works.
- **🔊 Stream languages** — Chrome/Firefox always play a file's *default*
  audio track, so each stream shows what you'll hear first, e.g.
  "🔊 Hindi (+ Tamil, English)". The languages come from the file's own MKV
  header when it can be read, otherwise from the release name.
  File hosts usually block browsers from reading that header, so the Reddate
  server reads it instead: only the first 64 KB (never the video), returning
  only the track languages. It refuses private/internal addresses and is
  rate-limited per client.
- Some addon sources take a while (sometimes a minute) to start; the player shows
  a loading notice and suggests picking another stream if one is slow.

> Reddate hosts no content. What a room can play depends entirely on the addons
> its members add — make sure the sources you use are ones you're allowed to stream.

Reddate also ships two addons of its own, served by the same server: **Reddate Catalog** (`catalog.js`, movies and series from TMDB, with your country and rows chosen on [/addon-list](https://tv.reddate.xyz/addon-list)) and **Reddate YT** (`yt-addon.js`, YouTube trending, music, gaming, news, search and channels, using your own free YouTube API key). Both work in Stremio and Nuvio too.
