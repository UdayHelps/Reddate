# Reddate — end-to-end test plan and road to production

Scope: the **TV app** (Android TV APK), the **browser app** (tv.reddate.xyz/app on desktop and phone), the
**engine** (`public/*.js`, shared by both), and the **server** (`server.js`, `accounts.js`) on the **live**
environment. `reddate.xyz` (branch `main`) is frozen and out of scope — nothing here may touch it.

The goal is twofold: (1) a one-off, try-to-break-it pass before calling the app production-ready, and
(2) a repeatable regression checklist to run before every TV release.

---

## 0. Ground rules for testing on live

- **Live = real users.** Use dedicated test accounts and party codes; never test inside someone else's party.
- **No deploys during a test session.** Every push restarts the server (rooms are in memory). Freeze pushes
  while a session runs, or results get polluted (the "host left" / "2 in room" reports were deploy restarts).
  Write down the server instance with `GET /api/room-status/<code>` at the start and end — if the
  `instance` value changed, a restart happened in between.
- **Secrets stay out of the repo.** The three addon links below carry personal tokens. Keep them in a
  password manager / private note, paste them into the app by hand, and rotate the TorBox token after the
  test cycle.
- **Record everything.** Each failure gets: build (TV `versionName`, web asset hash from `/app`), device,
  account, party code, time (with timezone), steps, expected, actual, screenshot/video.

### Test addons (links kept privately)

| Addon | Type | Why it matters |
|---|---|---|
| HdHub (thevolecitor) | HLS + direct, 2160p/1080p/720p, donation notes | Browser-playable HLS; addon "notes" chips |
| PenguPlay (pengu.uk) | direct links, support notes | Second source, auth-token manifest |
| StremThru Torz (TorBox store) | debrid'd torrents, mostly MKV/HEVC/Atmos | Heavy files: TV-only playback, stream ranking, dead links |

Plus the built-in **Reddate Catalog** and **OpenSubtitles v3** (subtitles).

### Test accounts (on tv.reddate.xyz; credentials in `~/Downloads/reddate-test-accounts.txt`, not in git)

| Account | Role | Profiles | Used on | Addons |
|---|---|---|---|---|
| **test1@email.com** | A — Host | `Me` (main), `Kids` | TV #1, Chrome desktop | all three (added by hand — test D1) |
| **test2@email.com** | B — Guest | `Me` | iPhone Safari, Android Chrome, 2nd browser | all three |
| **test3@email.com** | C — Fresh | none added | onboarding / empty states | none |
| **test4@email.com** | Spare — co-host / 4th viewer | `Me` | any | HdHub only |

### Devices / surfaces

| ID | Surface | How |
|---|---|---|
| TV1 | Android TV app (real TV) | latest APK from tv.reddate.xyz |
| TV2 | Android TV emulator (tv34, 1080p) | same APK, `adb` for logs/screens |
| PC1 | Chrome desktop 1920×1080 | tv.reddate.xyz/app |
| PC2 | Safari or Firefox desktop | second browser engine |
| M1 | iPhone (Safari) | real device or iOS simulator |
| M2 | Android phone (Chrome) | real device |
| W | 375×812 and 768×1024 viewports | browser responsive mode |

> This Mac has 8 GB RAM: run **one** emulator/simulator at a time, close Brave/Chrome while it runs.

---

## 0a. Who runs what (live sign-in and tokens)

- **Claude can:** check live pages and versions, drive the TV emulator on live after a pairing code is approved, read logs, take screenshots, and fill in this file.
- **You do:** sign in on live (test1–test4 from the local accounts file), add the three addon links on live (they carry your tokens), and approve the TV's pairing code from your phone.
- **Local copy:** the same plan can run on a local server where test accounts and addons are created freely. Use it for anything that could disturb live users.

## 0b. Run log

| Date | Step | Result | Notes |
|---|---|---|---|
| 2026-10-15 | 1 Smoke: app version and checksum | ✅ | 0.3.20, SHA-256 matches `version.json` |
| 2026-10-15 | 1 Smoke: routes | ✅ | 7 of 7 return 200 |
| 2026-10-15 | 1 Smoke: web bundle | ✅ | `index-46tBLYFy.js` |
| 2026-10-15 (local) | Sign-in form (desktop) | ✅ | account A and B sign in with the real form |
| 2026-10-15 (local) | D1 addons: add good link | ✅ | test addon added; name and streams show |
| 2026-10-15 (local) | D4 addons: bad links | ⚠️ | 404, unreachable and `http` refused with messages; a non-JSON page says "can't be reached" (vague; to fix) |
| 2026-10-15 (local) | S9 browser streams + tags | ✅ | "Plays here" tag; default "only streams that play here" filter on |
| 2026-10-15 (local) | W8 chat both ways (2 accounts) | ✅ | each side receives the other's line |
| 2026-10-15 (local) | W13 host leaves, only host | ✅ | guest sent out of the room |
| 2026-10-15 (local) | W22 closing the player keeps you in the room | ✅ | was ending parties (fixed) |
| 2026-10-15 (local) | Party/Join link always visible | ✅ | top bar: "Join a party" when not in one |
| 2026-10-15 (local) | Invite panel: "Or go to" + address | ✅ | browser; TV updated in next APK |
| 2026-10-15 (local) | W15/W16 TV host page frozen 40 s (busy TV) | ✅ | room, host and guest all kept (was: dropped by ping timeout after ~30 s, then the party ended) |
| 2026-10-15 (local) | Episode switch from the TV player with a browser guest | ✅ | guest follows; party stays |
| — | Streams page: scroll up from the top | ⏳ | fixed height change; check on TV |
| — | 1 Smoke: TV Home | ⏳ | not run locally yet |
| — | 1 Smoke: browser Home | ⏳ | waiting for sign-in (test1) |
| — | 1 Smoke: playback HLS and MKV | ⏳ | after sign-in |
| — | 1 Smoke: TV ↔ browser party | ⏳ | after both are signed in |

## 1. Smoke test (10 minutes, run first every time)

1. `GET /api/app-version` → version matches the APK on the site; SHA-256 of the download matches `version.json`.
2. `/`, `/app`, `/join/ABCD`, `/report`, `/?tv=1`, `/api/auth/config`, `/sw.js` → all 200.
3. TV1 opens → sign-in QR or Home within 10 s.
4. PC1 `/app` → Home with rows within 5 s; no console errors.
5. Play one HLS stream on PC1 and one MKV stream on TV1 → picture + sound within 15 s.
6. PC1 starts a party, TV1 joins by code → both play in sync, one chat message each way arrives.

If any step fails, stop and fix before the full pass.

---

## 2. Feature matrix — every screen, every button

Legend for "Where": **T** = TV app, **B** = browser desktop, **M** = browser phone.
Each row is one test. Mark ✅ / ❌ / ⚠️ per surface.

### 2.1 Accounts and devices

| # | Where | Steps | Expected |
|---|---|---|---|
| A1 | B M | Register a new account (C) | Signed in, onboarding shows, "Confirm your email" banner |
| A2 | B M | Sign out, sign in again | Same profiles, addons, Continue watching |
| A3 | B M | Wrong password ×6 | Clear error, rate-limit message, no crash |
| A4 | B M | Forgot password → link → new password | Old sessions signed out (incl. TV) |
| A5 | T | Fresh install → QR + code shown | Code readable, QR opens `/?link=CODE` |
| A6 | M | Scan TV QR while signed out | Sign-in first, then "Add this TV?" → Yes → TV signs in within 5 s |
| A7 | B | Account → Devices & TVs → type the TV code | Same as A6 |
| A8 | B | Account → Devices → Remove the TV | TV returns to sign-in screen within ~5 min (or on next open) |
| A9 | T | Account → Sign out of this TV (press twice) | Sign-in screen with a new code |
| A10 | T B | Expired/invalid code entry | Clear error, can retry |
| A11 | B | Delete account (test account only) | Signed out everywhere; email can register again |

### 2.2 Profiles

| # | Where | Steps | Expected |
|---|---|---|---|
| P1 | T B | Add profile, rename, delete | Changes appear on the other device within ~45 s |
| P2 | T B | Switch profile | Continue watching, subtitle language, addons switch with it |
| P3 | T B | "Who's watching?" with 2+ profiles | Shown once per session; Back/remote navigation works |
| P4 | B | Avatar menu → profiles, Edit profiles, Account, YouTube & links | All open; Back closes the menu first |
| P5 | T | Delete the active profile | Falls back to main profile, no crash |
| P6 | T B | Max profiles (6) | Add disabled with an explanation |

### 2.3 Addons

| # | Where | Steps | Expected |
|---|---|---|---|
| D1 | B | Account test1 → Addons → paste each of the 3 manifest links (HdHub, PenguPlay, StremThru Torz) | Each is added with its name and logo (or letter) and shows "streams"; a title then shows streams from all three |
| D1b | M | Same on test2 from a phone (paste from clipboard) | Same result; paste button works |
| D1c | T | TV signed into test1 → Addons screen | The three addons appear within ~45 s without re-adding |
| D1d | T B | Add on the TV via its Addons screen (QR → phone) | Phone page opens on Addons; added addon reaches the TV |
| D2 | T | Same addons appear on the TV (same profile) | Within ~45 s, or after "Sync with phone" |
| D3 | B T | Disable / re-enable / remove an addon | Streams list updates; Home rows update |
| D4 | B | Add a bad link (404, not a manifest, HTML page, `http://`) | Clear error, nothing added |
| D5 | B | Add the same addon twice | Refused or de-duplicated |
| D6 | T B | Addon with catalogs → "Customize Home" rows | Rows toggle and reorder correctly |
| D7 | T B | Profile without addons (account C) | Clear empty states everywhere ("Add a stream addon") |

### 2.4 Home, browse, search

| # | Where | Steps | Expected |
|---|---|---|---|
| H1 | T | Home opens: banner + first row | Backdrop never cut at the top, details readable |
| H2 | T | Down/Up through all rows | Two rows visible while browsing; no jumps; focus never lost |
| H3 | T | Hold Right along a row to the end, then Left back | Smooth, no freeze, posters load |
| H4 | T | Left from a row → rail; every rail item | Each opens; Back returns to the same poster |
| H5 | T | Continue watching card: OK, long-press → options | Resume / choose another stream / remove all work |
| H6 | B M | Home rows scroll, hero "Watch" | Opens the title on its streams; nothing auto-plays |
| H7 | T B M | Search: movie, show, actor, nonsense, emoji, 200-char string | Results or a clean "No results" |
| H8 | T B | Recent searches: add, remove one, clear all | Persist per device |
| H9 | B M | YouTube & links page: YouTube URL, youtu.be, Shorts, `.mp4`, `.m3u8`, junk | Valid ones play; junk gives a clear error |

### 2.5 Title page and streams

| # | Where | Steps | Expected |
|---|---|---|---|
| S1 | T | Open a movie | Streams load (placeholder cards first), first card focused, **nothing plays** |
| S2 | T | Open a show → season chips → move across all seasons | Focus stays on the chips; episodes update |
| S3 | T | Pick an episode | "Streams for SxEy" moves to the top; filters stay fixed while cards scroll |
| S4 | T | Quality chips All / 4K / 1080p / 720p & below | Counts correct; empty groups hidden |
| S5 | T | Addons button → pick one → All addons | Only that addon's streams; resets correctly |
| S6 | T | Language search: "hindi", "eng", "es", "🇮🇳", nonsense | Filters correctly; clear empty message |
| S7 | T | Addon note chips (Donate / Discord) | Open a dialog; never play |
| S8 | T | Device icons on cards | TV blue when playable; phone/PC blue **only** for H.264+AAC/MP4/HLS; HEVC/Atmos/DDP crossed |
| S9 | B M | Same title in the browser | "Plays here" / "Won't play here" tags after the check; working ones first |
| S10 | B | "Only streams that play here" off/on | Shows/hides the right ones |
| S11 | T B | Title with zero streams | Explanation why + "Add a stream addon" |
| S12 | T B | Very long title / description / 30 seasons / Specials (season 0) | Layout holds, no overflow |
| S13 | T | Play a dead link (StremThru often has some) | "Trying another…" then the next similar stream plays |

### 2.6 Player — solo

| # | Where | Steps | Expected |
|---|---|---|---|
| V1 | T | Play MKV/HEVC/Atmos 4K (StremThru) | Picture + sound (or a clear "can't decode" message) |
| V2 | B M | Play HLS (HdHub) | Picture + sound; volume and mute work |
| V3 | B M | Play a stream with Dolby audio | "No sound?" hint with "Pick another stream" |
| V4 | T B M | Pause/play, seek bar, ±10 s, scrub preview | Accurate; no double-trigger |
| V5 | T B | Subtitles: search, pick a language, an option, Off | Lines appear, timing right; "Showing now" updates |
| V6 | T B | Style & timing: size, position, colour, background, font, sync ± | Sample updates live; real subtitles follow; settings remembered after restart |
| V7 | T | Auto-sync on an online subtitle | Completes or explains why not |
| V8 | T B | Audio tracks on a multi-audio file | Switches without restarting the video |
| V9 | T B | Episodes panel: header stays fixed, play another episode | Next episode plays; dead link falls back |
| V10 | T B | Autoplay next episode on/off | Next starts 4 s after the end only when on |
| V11 | T B | Leave mid-movie → Continue watching | Resumes at the same spot with the same stream |
| V12 | B | Fullscreen in/out, Esc, keyboard (space, ←/→, f, m, c) | All work; Esc closes panels first |
| V13 | M | Rotate phone, lock screen, background the tab | Resumes correctly; no stuck black screen |
| V14 | B | Tab hidden for 2 min (muted and unmuted) | Video catches up to the room when visible |
| V15 | T | Back once (controls), Back twice (leave dialog) | Stop/Leave dialog styled; correct wording for host vs guest |

### 2.7 Watch party — multi-device (the part most likely to break)

Run with **TV1 + PC1 + M1 + M2** at once (4 viewers, 2 accounts, 3 profiles).

| # | Steps | Expected |
|---|---|---|
| W1 | PC1 starts a party from a title ("Start a watch party") | Invite panel opens once, closes after someone joins or 25 s |
| W2 | TV1 joins by code; M1 by link; M2 by QR | All four play within 2 s of each other |
| W3 | Host pauses/plays/seeks | Everyone follows within 1 s |
| W4 | Guest presses pause (guests-can-pause off) | "Only hosts can…"; guest snaps back |
| W5 | Host turns "Guests can pause" on → guest pauses | Everyone pauses |
| W6 | Make TV1 a co-host → TV1 changes the video | Everyone switches; new title shown (not the old one) |
| W7 | Remove a guest | Guest sent home with a message; can't rejoin silently |
| W8 | Chat: 20 messages each way, emoji, 500 chars, while the TV is on Home / in the player / in a panel | All arrive in order on all four; unread counts; "typing…" shows |
| W9 | Invite → "Your profiles": open a second profile on another device, wait | It appears in the open list within ~5 s; invite pop-up shows even on "Who's watching?" |
| W10 | Guest falls 30 s behind (throttle network) | "Behind" pill with Catch up / Ignore; co-hosts see it too |
| W11 | Guest's stream fails | Guest told; others unaffected |
| W12 | Host's video ends | Room stops at the end; nobody shown "behind" |
| W13 | Host leaves on purpose (only host) | Party ends for everyone: "X ended the party" |
| W14 | Host leaves while a co-host is present | Co-host takes over immediately |
| W15 | Host loses Wi-Fi 10 s, comes back | Still host; nobody kicked |
| W16 | Host loses Wi-Fi 60 s | Party ends after ~20 s grace (no host) |
| W17 | Guest reloads the page / app restarts | Rejoins the same room automatically |
| W18 | **Server restart mid-party** (push a no-op commit during the test) | No fake "left" lines; room restored with the same video, position and host; chat sent during the gap arrives |
| W19 | Two parties at once on different accounts | No cross-talk (chat, invites, counts) |
| W20 | Join a code that doesn't exist / expired / of a full or ended party | Clear message, back to Home |
| W21 | YouTube video in a party (PC1 host, TV1 guest) | Plays and syncs on both, or a clear "can't play here" |
| W22 | "Who's here" count after people leave | Matches reality within ~5 s (no ghost "2 watching") |

### 2.8 Reporting, updates, misc

| # | Where | Steps | Expected |
|---|---|---|---|
| R1 | T B | Report a bug with and without screenshot | Email arrives at the support inbox; rate limit after 6/hour |
| R2 | T | Updates: older APK installed → "Update available" | Downloads, verifies SHA-256, installs, keeps sign-in |
| R3 | T | Updates when already current | "You're up to date" |
| R4 | B M | Install as an app (PWA) on phone | Opens full-screen, works offline-gracefully (message, no white screen) |
| R5 | B M | Back button on every screen (app button, browser, phone gesture) | Closes the top layer first, then the previous screen; never exits unexpectedly |

---

## 3. Break-it sessions (exploratory, time-boxed 45 min each)

1. **Remote mashing (TV):** hold every D-pad direction for 10 s on each screen; spam OK/Back; press Back
   during loading cards. Watch for focus loss, crashes, double-opened screens.
2. **Network chaos:** throttle to 3G, drop Wi-Fi for 5/30/120 s, switch Wi-Fi ↔ mobile data on the phone,
   VPN on/off — during play, during joining, during addon add.
3. **Concurrency:** two hosts press pause at the same moment; host changes video while a guest is joining;
   three devices of the same profile all start parties.
4. **Data extremes:** 60 addons on a profile; an addon returning 500 streams; titles with no poster; Unicode
   and RTL titles; 6 profiles each with Continue watching.
5. **Long run:** a 3-hour party (two films back to back) — memory, drift, chat after hours, TV not sleeping.
6. **Low-end:** oldest supported Android TV device / 2 GB RAM; iPhone in Low Power Mode; Safari private tab.
7. **Hostile input:** HTML/script in chat, profile names, search, report text; huge pasted images in chat;
   malformed `/join/<junk>` and `/?link=<junk>` URLs.

---

## 4. Visual and design review

For each surface (T 1080p, B 1440/1920, M 375/414, tablet 768):

- Every screen screenshotted in both **loaded** and **loading/empty/error** states.
- Check against the house rules: tokens only (no stray colours), no italic headings, focus ring visible on
  every focusable thing (TV), 44 px touch targets (M), no horizontal scroll (M), text never truncated mid-word
  on buttons, contrast ≥ 4.5:1 for body text.
- TV safe area: nothing important within 5% of the screen edges.
- Compare against Nuvio on the same title: poster sizes, row spacing, focus scale, motion.
- Reduced-motion setting respected in the browser (shimmers and animations calm down).

---

## 5. Performance budgets (measure, don't guess)

| Metric | Target | How |
|---|---|---|
| TV cold start → Home interactive | < 6 s | stopwatch / `adb logcat` timestamps |
| Title open → first stream card | < 5 s (HdHub), < 10 s (StremThru) | stopwatch |
| Press play → first frame | < 4 s HLS, < 8 s 4K MKV | stopwatch |
| Party sync drift after 30 min | < 1 s between all devices | compare on-screen times |
| Chat delivery | < 500 ms | timestamps in two windows |
| Browser JS bundle | < 300 kB gzip | `vite build` output |
| TV app memory after 2 h | no growth > 20% | `adb shell dumpsys meminfo xyz.reddate.tv` |

---

## 6. Road to production — what to build so bugs stay fixed

### 6.1 Automated tests (none exist today)

1. **Server unit tests** (`node --test`): rooms (join/leave/restore), party rules (host handoff, end on
   last host, guests-can-pause), chat ack, invite targeting, rate limits. Run on every push.
2. **Socket integration test:** spin up `server.js` with `MAIL_MODE=log DEV_STORE_FILE`, connect 3–4
   `socket.io-client`s, script the W-scenarios above (join, sync, chat, restart, host leaves).
3. **Browser E2E (Playwright):** sign-up → add addon (local test addon) → play → party with two browser
   contexts → chat → leave. Desktop + iPhone viewport. Run against a local server in CI.
4. **TV UI tests:** Compose UI tests for Home navigation, title page focus, subtitles panel; plus a
   scripted `adb` smoke (install → launch → screenshot → compare) in CI on an emulator.
5. **Engine contract tests:** the RPC methods the TV and browser call (`state`, `play`, `streams`, `joinCode`,
   `chatHistory`, `devices`…) with fixed inputs → fixed outputs.

### 6.2 Release process

- Branch `tv` → **staging** service (`staging.tv.reddate.xyz`) first; production only after the smoke test
  passes there. Deploys during peak evening hours are frozen.
- TV releases: staged rollout (beta channel in `version.json` for test TVs first, then everyone).
- Every release has a short changelog (feature names + "X bugs fixed") and a rollback APK kept on the site.

### 6.3 Reliability

- **Rooms survive restarts better:** move room state to Redis (Upstash is already used for accounts) so a
  deploy or crash doesn't depend on clients restoring it.
- **Zero-downtime deploys:** Render health checks + graceful shutdown (already sends no "left" lines);
  consider two instances behind sticky sessions once rooms live in Redis.
- **Monitoring:** server error rate, socket disconnect spikes, `/api/crash` volume, play-failure rate per
  addon; alert by email. Keep `/api/room-status` for support.
- **Crash reporting on TV:** current `/api/crash` + a breadcrumb trail (last 20 actions) attached to reports.

### 6.4 Security and privacy

- Rotate any token that has been shared in chat or screenshots (TorBox, PenguPlay).
- Turnstile on sign-up (pending), email verification links in the browser app (pending).
- Content-Security-Policy review for `/app` (scripts, frames for YouTube, media hosts).
- Rate limits on: join attempts per IP, chat messages per socket, invite sends.
- Privacy page states what is stored (accounts encrypted at rest, chat never stored).

### 6.5 Known open items (from the current cycle)

- Browser can't play MKV/HEVC/Dolby audio — by design; make the "TV only" message consistent everywhere.
- iOS: verify on a real iPhone (simulator was unreliable on the 8 GB Mac).
- "Guest not shown on TV" report — not reproduced; re-test W22 with no deploys running.
- Forgot-password and verify-email flows inside the browser app.
- A landing page for reddate.xyz's TV product and a final browser domain.

---

## 7. Exit criteria for "production ready"

- Smoke test green on all surfaces for 3 consecutive releases.
- Feature matrix: 100% of rows ✅ on T, B, M (or a documented, intentional ⚠️).
- Break-it sessions: no crash, no data loss, no stuck screen without a way out.
- W18 (server restart) and W13–W16 (host leaving) pass twice in a row.
- Automated tests (6.1 items 1–3) running in CI and green.
- No open bug tagged **blocker** or **major**.
