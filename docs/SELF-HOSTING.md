# Running your own Reddate

The server is one long-lived Node process (Socket.IO keeps rooms in memory), so it needs a host that keeps a process alive: a VPS, Render, Railway, Fly.io or your own machine. Serverless hosts will not work without a rewrite.

## Quick start

Requires Node.js 18 or newer.

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

## Two sites from one repository

`tv.reddate.xyz` runs the `tv` branch (this default branch). `reddate.xyz` runs the smaller `main` branch (the original watch-party page). On Render that is two web services, one per branch, each with `npm install` and `node server.js`.

## Large files

The TV app is published as a GitHub Release and the site's videos live in `docs/media/` (GitHub Pages), so the server never serves them. The server redirects `/get` to the latest release. Set `APK_URL` to host the app file somewhere else, or put a copy at `downloads/reddate-tv.apk` to serve it from the server itself.
