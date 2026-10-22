# Reddate

Create a private room, drop in a video, and watch it in perfect sync while you
chat — with a Discord-style **voice/video lounge**. Chats and rooms are never
stored: rooms disappear the moment everyone leaves. Accounts are optional (see
*What is and isn't private*).

Originally built as a two-person virtual-date page, now reworked so **anyone,
anywhere** can spin up a room and share the link. Styled after Reddit
(light and dark themes, orange accent).

## Features

- 🎬 **Synced video playback** — YouTube links *and* direct video URLs (`.mp4`,
  `.webm`, `.ogg`, …). Play, pause, seek and load together; late joiners and
  drifters auto-catch-up. Playback commands that arrive before a viewer's player
  is ready are buffered and applied on load, so nobody has to "press play first".
- 💬 **Chat that isn't stored** — the server relays messages between the people in
  a room and keeps nothing: no history, no logs of what was said. (It is *not*
  end-to-end encrypted; the server can see messages while relaying them.)
- 🎙️ **Lounge** — Discord-style: anyone in the room can hop in or out, up
  to 8 people, mic on and camera optional, with a speaking indicator.
  Peer-to-peer over WebRTC (a mesh); WebRTC encrypts the audio and video between
  the participants. Signaling is relayed through the room and media never
  touches the server.
- 🖼️ **Images & GIFs** — upload an image (sent as a data URL, 2 MB cap), or
  pick a GIF from the GIPHY picker (trending on open, search as you type, more
  loads as you scroll). Needs a free `GIPHY_API_KEY` — see *Getting started*.
- ⌨️ **Live typing indicators** and reaction "rain" on trigger words (`love`,
  `lol`, `fire`, …), detected locally on decrypted text.
- 💬 **Lightweight polls** to keep the room fun.
- ⬆️⬇️ **Reddit-style UI** — subreddit-style header, OP tag, cosmetic upvote/downvote,
  and a "Comment" send button.
- 🔗 **Shareable invite links** — create a room, copy the link, send it to anyone.
- 👥 **Multi-participant rooms** — share the link with as many people as you like
  (voice holds up to 8; chat and video sync have no limit).
- 🍿 **Browse movies & shows with Stremio/Nuvio addons** — paste any
  Stremio-compatible addon URL into a room and everyone in it can browse
  catalogs, search, pick a season/episode, and play a stream in sync.

## Addons (Stremio / Nuvio compatible)

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

## How privacy works

Reddate is built to keep as little as possible:

1. **Rooms live in memory only.** A room is a random ID in the invite link
   (`.../#room=<id>`). When the last person leaves, the room, its chat and its
   addon list are gone. Nothing about a room is written to disk or a database.
2. **The server relays chat; it doesn't keep it.** Chat is not end-to-end
   encrypted, so the server can technically see messages while passing them on.
   It doesn't store or log them.
3. **Anyone with the invite link can join**, so treat the link like a password.
4. **Optional accounts** keep an email, a hash of your password, and your saved
   profiles and addons, encrypted at rest with a key held only by the server
   (so a leaked database alone exposes nothing, but whoever runs the server can
   read it). There's no recovery code: "Forgot password" works by email.

### What is and isn't private

| Data | Notes |
|------|-------|
| Chat text & images | Relayed by the server in plain form while passing between participants; **never stored or logged** |
| Voice/video (Lounge) | Peer-to-peer between participants, encrypted in transit by WebRTC; never touches the server |
| A room's addon list (and any tokens in addon URLs) | Visible to everyone in the room and to the server **while the room exists**; never stored |
| Which video is loaded / playback position | Relayed by the server (it coordinates sync), including a picked stream's URL and title |
| GIF searches | Sent from your browser straight to GIPHY |
| GIF images, direct video links, addon requests | Fetched from the external host, revealing your IP address to it |
| Account (optional): email, profiles, saved addons | Email stored for confirmation and reset mail. Password stored only as a salted hash. Saved profiles/addons are encrypted at rest with `VAULT_SECRET`, but readable by the server. Online status for "watch together" invites is held in memory only. |
| Usage stats (if enabled) | Anonymous counts only: visits, unique visitors per day (salted hash, salt rotated daily, never stored), rooms, joins, messages, videos started by type, feature use. No IPs, room links, chat, names or titles. |
| Stream files' audio languages | When the file host blocks the browser, the server reads the file's first 64 KB to list its languages, so it sees those candidate stream URLs |

## Getting started

Requires Node.js 14+.

```bash
npm install
npm start          # or: npm run dev  (auto-reload with nodemon)
```

Then open http://localhost:3000, enter a display name, and click
**Create a room**. Copy the invite link and share it. Use **Browse** to pick a title, or paste a
YouTube / direct video link, and hit **Lounge** to talk (and optionally share
video) with up to 8 people.

Set a custom port with `PORT=8080 npm start`.

Optional environment variables (locally, put them in a `.env` file next to
`server.js` — it's git-ignored; see `.env.example`):

- `RESEND_API_KEY`, `MAIL_FROM`, `PUBLIC_URL`, `VAULT_SECRET` — turn on accounts (they also
  need the Upstash settings below, to store them). `VAULT_SECRET` is a long random string that
  encrypts saved accounts at rest; **keep a copy — if it's lost, saved accounts can't be read.** `MAIL_MODE=log` prints mail to the console and
  keeps accounts in memory, for local development only.
- `SUPPORT_URL` — optional; shows a "Buy me a coffee" link (https only).
- `GIPHY_API_KEY` — turns on the GIF picker. Get a free key at
  [developers.giphy.com](https://developers.giphy.com/) → *Create an App* → *API*.
  (Tenor's API shut down on 30 June 2026.)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `STATS_PASSWORD` — turn on
  the private stats page at `/stats` (log in with any username + the password).
  Counts are stored in a free [Upstash](https://upstash.com) Redis database.
- `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` — a TURN relay for calls behind
  strict NATs. STUN-only (default) works on most networks.

## Project structure

```
server.js          # Socket.IO relay server: rooms, video-state sync, chat relay, Lounge signaling
stats.js           # Anonymous usage counts → Upstash Redis (batched); powers /stats
views/stats.html   # The private stats page (served only after the password check)
public/index.html  # Markup + styles (lobby + app shell)
public/app.js      # Client logic: chat, video sync (YouTube + direct links + HLS), polls
public/addons.js   # Stremio-compatible addons: catalogs, search, episodes, stream picker
public/tracks.js   # Per-viewer subtitles (addon + local files) and audio-track switching
public/mkv.js      # MKV header reader (audio track languages), shared by browser and server
public/badges.js   # Stream badges (resolution, service, HDR, source, audio, codec, edition)
public/voice.js    # Discord-style voice room, up to 8 (WebRTC mesh)
```

The server keeps all room state in memory (`rooms` Map) and never inspects
message contents.

## Deploying

This is a **single long-lived Node process**: Socket.IO needs a persistent
connection and rooms live in memory, so it must run on a platform that keeps a
process alive — not on serverless/static hosts. **Vercel and Netlify won't work
without a rewrite** (they'd need an external WebSocket service + Redis for shared
state). Good fits: **Render**, **Railway**, **Fly.io**, or any VPS.

Run behind **HTTPS** — invite links stay protected in transit, and browsers only
grant camera/mic (for calls) on secure origins.

### Render (one-click Blueprint)

A [`render.yaml`](render.yaml) blueprint is included. On [render.com](https://render.com):

1. **New +** → **Blueprint**, connect this GitHub repo.
2. Render reads `render.yaml` and provisions a free web service (`npm install`
   → `npm start`). `PORT` is injected automatically.
3. (Optional) Set `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` in the
   dashboard for reliable calls behind strict NATs. STUN-only works otherwise.

Then open the service URL, pick a name, and create a room.


## Roadmap

Ideas where help is welcome (open an issue to say you're taking one):

- **TV mode** — a big-screen view (video + read-only comments overlay, join by
  QR code from your phone) and, later, an Android TV / Google TV wrapper app
- Shared video queue
- QR-code room invites
- YouTube search inside the YouTube tab
- Better handling of MKV files on phones
- Testing on real devices: iPhone Safari, Android Chrome, Google TV

## Disclaimer

Reddate **hosts no videos and is not a streaming service.** It syncs playback
and chat between people who each load their own sources. The built-in catalog
is movie/show metadata only; any addons are added by the people in a room, who
are responsible for what they play and for following the laws and terms that
apply to them. Reddate is not affiliated with Stremio, Nuvio, TorBox, GIPHY,
OpenSubtitles, YouTube or any addon or service mentioned here.

**Built with a lot of AI help.** Much of this code was written with AI
assistants (Claude), directed and tested by a human. It works, but treat it
like any young project: read the code, report problems, and send fixes.

## Contributing & security

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started. To report a security
issue, follow [SECURITY.md](SECURITY.md) — please don't use a public issue.

## Credits

- Icons: [Lucide](https://lucide.dev) (ISC licence), embedded in the page.
- Fonts: [Geist and Geist Mono](https://vercel.com/font), Bricolage Grotesque, Hanken Grotesk and JetBrains Mono
  (all SIL Open Font Licence), loaded from Google Fonts or bundled with the apps.
- Video playback of HLS streams: [hls.js](https://github.com/video-dev/hls.js)
  (Apache-2.0), loaded from cdnjs.
- Movie and series data and images from [TMDB](https://www.themoviedb.org) (when `TMDB_TOKEN` is set).
  *This product uses the TMDB API but is not endorsed or certified by TMDB.*
- Subtitles from OpenSubtitles (via addon), GIFs from [GIPHY](https://giphy.com).
- Stream badge logos are loaded from Wikimedia Commons and remain the property
  of their respective owners.

## License

[MIT](LICENSE) © 2026 Uday Katare


## Reddate TV (this repository)

This repository holds everything that runs [tv.reddate.xyz](https://tv.reddate.xyz):

- `android-tv/`: the Android TV app (Kotlin and Jetpack Compose over a hidden WebView "engine" that runs the pages below).
- `web/`: the browser app (React and Vite). `web/dist` is the built copy the server serves.
- `public/tv.js`, `home.js`, `account.js`, `pages.js`: the engine that the TV and browser apps share.
- `accounts.js` (sign-in, profiles, pairing), `catalog.js` (TMDB catalog with Top 10 rows), `yt-addon.js` (Reddate YT),
  `trackers.js` (Trakt and Simkl), `tv-site/` (the info site).

The downloadable TV app is published as a [GitHub Release](../../releases/latest) (`reddate-tv.apk`), and the site's
large videos live in `docs/media/` (served by GitHub Pages). The server redirects `/get` to the latest release, so
downloads never use the server's bandwidth. Set `APK_URL` to host the file somewhere else, or drop a copy in
`downloads/reddate-tv.apk` to serve it from the server itself.

To build the TV app yourself you need Android Studio's SDK and a signing key of your own; the release key is never in
this repository (`android-tv/app/build.gradle.kts` reads `~/.reddate/keystore.properties`).

Data credit: this product uses the TMDB API but is not endorsed or certified by TMDB. Streaming-availability data is provided by JustWatch.
Poster images in the demo pictures belong to their owners.
