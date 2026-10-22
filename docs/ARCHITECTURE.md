# Architecture

Reddate is three things that share one engine: a **server**, a **browser app** and an **Android TV app**.

```
Android TV app ──┐                        ┌── Upstash Redis (accounts, sessions, stats)
(Compose + hidden │                        │
 WebView engine)  ├── Socket.IO + HTTPS ──┤   server.js   ── TMDB (catalog, Top 10)
Browser app ─────┘                        │   (one Node    ── Resend (mail)
(React)                                    │    process)
        └── addons (Stremio format) ──────┘   directly from the device
```

## The server (`server.js`)

One long-lived Node process. Rooms, parties and the video "anchor" live **in memory**; a restart drops them and clients rebuild them on reconnect (a returning viewer says what was playing and where).

### Rooms and sync

- A room has one **anchor**: the position at a moment in server time, and whether it is playing. Only play, pause and seek move it.
- Each client steers its own player toward the anchor once a second (`driftTick` in `public/app.js`). Small drift is fixed by playing slightly faster or slower; large drift by a seek. A viewer is never pulled to someone else's position, so a slow connection only makes that one viewer catch up.
- Clocks are matched with a `time` round trip (`checkClock`), taken at connect and every minute, keeping the sample with the smallest round trip.
- **Lazy rooms.** On a TV nobody is "in a room" until they invite someone. Watching alone is handled locally and creates nothing on the server.
- **Parties.** The person who invites is the host. Hosts can be added, hosts can allow guests to pause, and a host who drops out has 60 seconds before control passes to a guest. Guests pick their own subtitles and audio.
- Chat is relayed and never stored. A flood limit holds each network address to a share of sockets and joins.

### Accounts (`accounts.js`)

Optional sign-in. An account holds the email, a salted scrypt hash, sessions (hashed tokens) and a **vault** with up to six profiles, each with addons and preferences. The vault is encrypted at rest with a key derived from `VAULT_SECRET`. Storage is Upstash Redis over its REST API; in local test mode (`MAIL_MODE=log`) everything stays in memory. A TV pairs by showing a code that a phone approves.

### Catalog and addons

- `catalog.js`: a Stremio-format addon backed by TMDB, with an in-memory cache. Personal links (`/catalog/c/<choices>/`) carry a country and a list of rows.
- `yt-addon.js`: Reddate YT. The user's own YouTube API key travels inside their install link, sealed with AES-GCM; the server only uses it to ask Google for public data. Videos play in the app's YouTube player.
- `trackers.js`: Trakt and Simkl watch tracking.
- Other addons are fetched by the device directly. The server never proxies them, except `/media-info`, which reads the first 64 KB of a file to list its audio languages (private addresses refused).

## The browser app (`web/`)

React and Vite. It runs the engine pages (`public/*.js`) in a hidden frame and draws the interface itself; the built copy in `web/dist` is what the server serves.

## The Android TV app (`android-tv/`)

Two layers. Underneath, the engine page runs in a WebView: rooms, sync, chat, accounts and addons. On top, native screens (Jetpack Compose for TV) draw Home, titles, search and settings, and a native Media3 player plays what the TV's hardware can decode. The page tells the app when one of its own screens must be on top (sign-in, a YouTube video), and the app asks the page things through a small RPC.

Streams are ranked before they are shown: the engine fetches every stream addon at once, the app measures time to first byte and speed on the first 512 KB of each, and the list is ordered by how well it will play on this device.

## Where it is slow, and what we measured

See [PERFORMANCE.md](PERFORMANCE.md).
