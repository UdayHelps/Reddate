# Reddate backend: how it works, where it is slow, and what to fix

Measured on 2026-10-18 from Dubai against https://tv.reddate.xyz (live) and a local copy of the same code (load tests).
Probe scripts are in `docs/perf/`.

## How it works (the short version)

- One Node process (`server.js`, Express + Socket.IO) on Render, behind Cloudflare. Rooms, the video "anchor", chat relay,
  parties and host hand-over live **in that process's memory**. A deploy or restart drops every room (clients rebuild them).
- Sync model: the room keeps one anchor (position at a server timestamp + playing or not). Each player steers itself to it
  (`driftTick`, once a second). Clocks are matched with a `time` round trip (`checkClock`).
- Accounts, profiles, pairing codes and sessions are in **Upstash Redis over its REST API** (`accounts.js`). Stats are batched (`stats.js`).
- Catalog (`catalog.js`) is a TMDB proxy with an in-memory cache; stream addons and the stream test-play run on the device.
- The TV app is a native UI over a hidden WebView "engine" that loads the same page as the browser app.

## What we measured

| What | Result | Meaning |
|---|---|---|
| First request after idle | **22.4 s** | Render free plan asleep. This is the worst lag anyone sees. |
| Cloudflare edge to us | 10 ms TCP, ~35 ms TLS | The edge in Dubai is close. |
| Edge to origin, any request | ~105 ms (a tiny JSON answer takes 140-150 ms) | Distance to the Render region, not server speed. |
| Socket round trip (`time` ack) | min 86 / p50 89 / p90 93 / max 98 ms | One-way is ~45 ms. This is the floor for sync from here. |
| Clock offset spread | 5 ms over 30 samples | Clock matching is accurate. Not a problem. |
| Socket connect (WebSocket first / polling first) | ~230 / ~440 ms | The app uses polling first (`io()` with defaults). |
| One Upstash call | **~230-325 ms** (device/start with 2 sequential writes: 600-790 ms vs 140 ms baseline) | Upstash is far from the server, or slow per call. |
| `hello` on every socket connect | 2 sequential Upstash reads, **~0.5 s**, and `join-room` waits for it | Every signed-in device pays this on every (re)connect. |
| Every authenticated API call (`requireAuth`) | the same 2 reads, plus the work | `/api/vault` boot ~0.65 s, vault save ~0.75 s+. |
| Catalog row, warm | 140-150 ms | Network only. |
| Catalog row, cold | 1.3 s (trending); **3.6-3.9 s** (Netflix/Prime Top 10) | 4 pages + 80 `watch/providers` calls at 8 at a time. |
| Series page, cold | 1.4 s (Thrones), **4.3 s** (The Simpsons, 372 KB) | Fetches every season (5 at a time). |
| Static scripts / catalog JSON | `cf-cache-status: DYNAMIC` | Cloudflare caches **nothing**: every request goes to the origin. |
| Boot page | 12 script files, ~150 KB brotli, all revalidated each start, YouTube script first and blocking | Slow start on a TV WebView. |
| Fan-out, 100 rooms x 5 (500 people) | play/pause p50 6 ms, p95 15 ms | The sync path itself is cheap. |
| Fan-out, 400 rooms x 5 (2000 people) | p50 37 ms, p95 88 ms, RSS 158 MB | Fine on this laptop. The free plan has about a tenth of a CPU. |
| One room of 500, joins settled | play/pause p95 **11 ms** | Fan-out is not the problem. |
| One room of 500, joining | join p50 1.5 s, p95 4.6 s, max 5.7 s | **O(n^2)** user-list broadcast on every join. |
| Chat image 1.5 MB | **sender's connection closed (code 1009)** | Socket.IO's default 1 MB limit; the client allows 2 MB. |

## Bottlenecks, worst first

1. **Cold start, 22 s.** Free plan sleeps after idle; the catalog cache is lost with it. First TV launch of the day sees "Can't reach Reddate".
   Fix: paid always-on plan (Starter), or at least an uptime monitor hitting `/api/web-version` every 5 min (one free service fits Render's monthly free hours). A deploy has the same effect: every push restarts the server and drops all parties.
2. **Upstash is ~250 ms a call and we call it twice per session check.** Fix: create the Upstash database in the same region as Render; cache `session hash -> { uid, device }` in memory (5 min, drop on logout) so `hello` and `requireAuth` don't read the whole encrypted account just to learn a user id. Expected: join and sign-in -0.5 s; vault saves -0.5 s.
3. **Nothing is cached at the edge, and the origin is ~105 ms away.** Fix: Cloudflare Cache Rule for `/catalog/*` and `/assets/*` (respect origin TTL, serve stale while revalidating); versioned file names + `Cache-Control: public, max-age=31536000, immutable` for scripts/CSS/images; `max-age=600, stale-while-revalidate` for HTML pages. Expected: warm catalog rows ~145 ms -> ~30 ms for Dubai users, and they keep working while the origin wakes.
4. **Server region.** ~105 ms edge-to-origin from Dubai suggests Frankfurt or Singapore (cannot tell from outside; check the Render dashboard). India and the Gulf are best served from Singapore (Mumbai ~60 ms vs Frankfurt ~120 ms). Rooms are in memory, so run one region, not several.
5. **Cold TMDB.** Each TMDB call is ~0.4 s from the server. Fix: warm the home rows (Today, each streaming service, trending, popular) at boot and every few hours for the regions in use, refresh them in the background before they expire (serve the old copy meanwhile), and raise TMDB concurrency. For long series load season 1 first and the rest on demand. Expected: Home and Top 10 never wait; series page 4.3 s -> ~0.6 s.
6. **Boot page.** `https://www.youtube.com/iframe_api` is a blocking script at the top (and we now only need it when a YouTube video plays): load it on demand. Add `defer` to the rest, drop the `document.write` for `voice.js`, use `transports: ['websocket']`, and let the TV engine cache scripts for a few minutes (revalidating 12 files on each start costs a round trip each).
7. **User list broadcast is O(n^2).** `broadcastUserCount` sends the whole list to everyone on every join, leave and buffering change. Fine under ~50 people, hurts at 150+, a 500-person party takes up to 5 s to fill (worse on the free CPU). Fix: coalesce into one send per 250 ms, send only the count above ~50 people, send changes instead of the list.
8. **Chat image over 1 MB drops the sender.** Set `maxHttpBufferSize` to ~4 MB on the Socket.IO server (or cap images at 900 KB on the client). This may explain some of the "dropped out of the party" reports.
9. **Smaller ones:** `/media-info` has no cache (same file URL fetched again by every viewer): add a small LRU. `crypto.scrypt` (logins) and `dns.lookup` share libuv's 4-thread pool, so a few logins can delay DNS: set `UV_THREADPOOL_SIZE=8`. Catalog cache is capped by count (3000), not size; a few big series entries (372 KB each) could grow it: cap by bytes. Presence takes up to 60 s to notice a dead connection (ping 20 s + timeout 40 s), then a 60 s host grace: a TV unplugged takes ~2 min to hand control over. Voice calls use STUN only: add a TURN relay for mobile networks.

## Sync quality (low latency)

What is already good: the anchor model, no player is ever pulled to another's position, clock offset is steady (5 ms), play/pause relay is a few ms on the server.

What limits it today:
- The floor is network: ~45 ms one way from Dubai to the origin. Moving the server closer and keeping the socket warm are the only ways below that.
- Drift tolerance is loose: nothing happens under 0.4 s; 0.4-5 s is fixed by speeding up or slowing down (8% or 15%), hard seek only past 5 s (3.5 s on players without rate control). A viewer 3 s behind needs ~20-40 s to catch up. Tighten to ~0.15 s for rate nudges and ~1.5 s for a hard seek on players that seek quickly (browser, ExoPlayer); keep the current values for YouTube.
- On a play event peers only seek if more than 1 s off, so up to ~1 s of difference can start and then sit until the 0.4 s rule corrects it.
- The first seek aims 2.5 s ahead (`seekLag` starts at 2500 ms) until it learns; start it lower (~800 ms) on desktop and TV.
- The first clock check happens after joining; use the `serverTime` already in the join reply for a first estimate.
- Add a visible ping (the `time` round trip is already measured every minute) and send it with `buffering`, so the host can see who is slow.

## Order of work

1. Today, no code: always-on plan or uptime monitor; Upstash database in the Render region; Cloudflare cache rules. (Fixes 1, 2 partly, 3.)
2. One small server change: session cache, `maxHttpBufferSize`, coalesced user list, catalog prewarm and background refresh, `UV_THREADPOOL_SIZE`. (2, 5, 7, 8, 9.)
3. Client: websocket-only, deferred scripts, YouTube script on demand, tighter drift thresholds, ping display. (6, sync.)
4. Decide the region from where the people are. (4.)

Not measured: real Render CPU limits under load (the load tests ran on a fast laptop, so treat the free-plan limits as lower by roughly 10x), Upstash's region, and real addon speed (addons run on the device, not on our server).
