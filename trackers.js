// Watch trackers: Trakt, WeTrakr and Simkl. A signed-in Reddate account can connect any of them (the TV shows a code to
// type at the tracker's own page), and what it plays is then reported as it plays ("scrobbling": started, paused, stopped).
//
// Each tracker is off until its app key is set (an app has to be registered with the tracker first):
//   TRAKT_CLIENT_ID + TRAKT_CLIENT_SECRET · WETRAKR_CLIENT_ID (+ optional WETRAKR_CLIENT_SECRET) · SIMKL_CLIENT_ID (+ SIMKL_CLIENT_SECRET)
// The tracker's tokens stay on the server, inside the encrypted account record, and are never sent to a screen.

const SERVICES = {
    trakt: {
        name: 'Trakt', base: process.env.TRAKT_BASE || 'https://api.trakt.tv',
        id: process.env.TRAKT_CLIENT_ID || '', secret: process.env.TRAKT_CLIENT_SECRET || '',
        headers: id => ({ 'trakt-api-version': '2', 'trakt-api-key': id }), flow: 'device'
    },
    wetrakr: {
        name: 'WeTrakr', base: process.env.WETRAKR_BASE || 'https://api.wetrakr.com',
        id: process.env.WETRAKR_CLIENT_ID || '', secret: process.env.WETRAKR_CLIENT_SECRET || '',
        headers: id => ({ 'wetrakr-api-version': '1', 'wetrakr-api-key': id }), flow: 'device'
    },
    simkl: {
        name: 'Simkl', base: process.env.SIMKL_BASE || 'https://api.simkl.com',
        id: process.env.SIMKL_CLIENT_ID || '', secret: process.env.SIMKL_CLIENT_SECRET || '',
        headers: id => ({ 'simkl-api-key': id }), flow: 'pin'
    }
};
const configured = s => Boolean(SERVICES[s] && SERVICES[s].id);
const APP_VERSION = '0.4';

// ---------- what is playing, as the trackers want it ----------
// Reddate's own ids: tt1234567 (a film), tt1234567:2:5 (an episode), tmdb:movie:603, tmdb:series:1399:2:5.
function mediaOf(type, id) {
    const s = String(id || '');
    let m = /^(tt\d{5,10})(?::(\d{1,3}):(\d{1,4}))?$/.exec(s);
    if (m) return m[2] ? { show: { ids: { imdb: m[1] } }, episode: { season: +m[2], number: +m[3] } } : { movie: { ids: { imdb: m[1] } } };
    m = /^tmdb:(movie|series):(\d{1,9})(?::(\d{1,3}):(\d{1,4}))?$/.exec(s);
    if (m) return m[3] ? { show: { ids: { tmdb: +m[2] } }, episode: { season: +m[3], number: +m[4] } } : (m[1] === 'movie' ? { movie: { ids: { tmdb: +m[2] } } } : null);
    return null;
}

async function call(svc, method, path, { body, token, query } = {}) {
    const S = SERVICES[svc];
    const url = new URL(S.base + path);
    Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...S.headers(S.id) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

// ---------- connecting ----------
const pending = new Map(); // `${acct}:${svc}` -> { device, user, url, until, interval }

async function startConnect(acctId, svc) {
    const S = SERVICES[svc];
    if (S.flow === 'pin') {
        const r = await call(svc, 'GET', '/oauth/pin', { query: { client_id: S.id } });
        if (r.status !== 200 || !r.data.user_code) throw new Error('start');
        const out = { userCode: r.data.user_code, url: r.data.verification_url || 'https://simkl.com/pin/', expiresIn: r.data.expires_in || 900, interval: r.data.interval || 5 };
        pending.set(`${acctId}:${svc}`, { device: out.userCode, until: Date.now() + out.expiresIn * 1000 });
        return out;
    }
    const r = await call(svc, 'POST', '/oauth/device/code', { body: { client_id: S.id } });
    if (r.status !== 200 || !r.data.device_code) throw new Error('start');
    const out = { userCode: r.data.user_code, url: r.data.verification_url || '', expiresIn: r.data.expires_in || 600, interval: r.data.interval || 5 };
    pending.set(`${acctId}:${svc}`, { device: r.data.device_code, until: Date.now() + out.expiresIn * 1000 });
    return out;
}

// -> { status: 'pending' | 'connected' | 'expired' | 'denied' | 'none', tokens? }
async function pollConnect(acctId, svc) {
    const S = SERVICES[svc], key = `${acctId}:${svc}`, p = pending.get(key);
    if (!p) return { status: 'none' };
    if (Date.now() > p.until) { pending.delete(key); return { status: 'expired' }; }
    if (S.flow === 'pin') {
        const r = await call(svc, 'GET', `/oauth/pin/${encodeURIComponent(p.device)}`, { query: { client_id: S.id } });
        if (r.status === 200 && r.data.result === 'OK' && r.data.access_token) { pending.delete(key); return { status: 'connected', tokens: { access: r.data.access_token, refresh: '', exp: 0 } }; }
        return { status: 'pending' };
    }
    const r = await call(svc, 'POST', '/oauth/device/token', { body: { code: p.device, client_id: S.id, ...(S.secret ? { client_secret: S.secret } : {}) } });
    if (r.status === 200 && r.data.access_token) {
        pending.delete(key);
        return { status: 'connected', tokens: { access: r.data.access_token, refresh: r.data.refresh_token || '', exp: r.data.expires_in ? Date.now() + r.data.expires_in * 1000 : 0 } };
    }
    if (r.status === 410) { pending.delete(key); return { status: 'expired' }; }
    if (r.status === 418 || r.status === 404 || r.status === 409) { pending.delete(key); return { status: 'denied' }; }
    return { status: 'pending' }; // 400 (not yet) and 429 (slow down): keep waiting
}

async function refresh(svc, t) {
    const S = SERVICES[svc];
    if (!t.refresh) return null;
    const r = svc === 'trakt'
        ? await call(svc, 'POST', '/oauth/token', { body: { refresh_token: t.refresh, client_id: S.id, client_secret: S.secret, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token' } })
        : await call(svc, 'POST', '/oauth/token/refresh', { body: { refresh_token: t.refresh, client_id: S.id, ...(S.secret ? { client_secret: S.secret } : {}), grant_type: 'refresh_token' } });
    if (r.status !== 200 || !r.data.access_token) return null;
    return { access: r.data.access_token, refresh: r.data.refresh_token || t.refresh, exp: r.data.expires_in ? Date.now() + r.data.expires_in * 1000 : 0 };
}

// ---------- reporting playback ----------
async function scrobbleOne(svc, rec, action, payload, onTokens) {
    const send = token => call(svc, 'POST', `/scrobble/${action}`, { token, body: payload });
    let r = await send(rec.access);
    if (r.status === 401) {
        const fresh = await refresh(svc, rec).catch(() => null);
        if (!fresh) return { ok: false, expired: true };
        onTokens(fresh);
        r = await send(fresh.access);
    }
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
}

function mount(app, { requireAuth, saveAcct, wrap, express }) {
    app.use('/api/trackers', express.json({ limit: '10kb' }));
    const hits = new Map();
    const allow = (key, max, windowMs) => {
        const now = Date.now(), h = hits.get(key);
        if (!h || h.resetAt < now) { hits.set(key, { count: 1, resetAt: now + windowMs }); if (hits.size > 20000) hits.clear(); return true; }
        return ++h.count <= max;
    };
    const svcOf = req => (SERVICES[req.params.svc] ? req.params.svc : null);

    // The list for the Account screen: which trackers exist here, and which this account has connected.
    app.get('/api/trackers', requireAuth, (req, res) => {
        const mine = req.acct.trackers || {};
        res.set('Cache-Control', 'no-store').json({ services: Object.keys(SERVICES).map(id => ({
            id, name: SERVICES[id].name, available: configured(id), connected: Boolean(mine[id] && mine[id].access), expired: Boolean(mine[id] && mine[id].expired),
            scrobble: Boolean(mine[id] && mine[id].scrobble !== false)
        })) });
    });

    app.post('/api/trackers/:svc/connect', requireAuth, wrap(async (req, res) => {
        const svc = svcOf(req);
        if (!svc || !configured(svc)) return res.status(404).json({ error: 'That service isn’t available yet.' });
        if (!allow(`tc:${req.acct.id}`, 10, 15 * 60000)) return res.status(429).json({ error: 'Slow down. Try again in a few minutes.' });
        try { res.json(await startConnect(req.acct.id, svc)); }
        catch (e) { res.status(502).json({ error: `Couldn’t reach ${SERVICES[svc].name}. Try again.` }); }
    }));

    app.post('/api/trackers/:svc/poll', requireAuth, wrap(async (req, res) => {
        const svc = svcOf(req);
        if (!svc || !configured(svc)) return res.status(404).json({ error: 'That service isn’t available yet.' });
        if (!allow(`tp:${req.acct.id}`, 400, 15 * 60000)) return res.status(429).json({ error: 'Slow down.' });
        let r;
        try { r = await pollConnect(req.acct.id, svc); } catch (e) { return res.json({ status: 'pending' }); }
        if (r.status === 'connected') {
            req.acct.trackers = { ...(req.acct.trackers || {}), [svc]: { ...r.tokens, scrobble: true, at: Date.now() } };
            await saveAcct(req.acct);
        }
        res.json({ status: r.status });
    }));

    app.put('/api/trackers/:svc', requireAuth, wrap(async (req, res) => {
        const svc = svcOf(req), rec = svc && (req.acct.trackers || {})[svc];
        if (!rec) return res.status(404).json({ error: 'Not connected.' });
        if (typeof (req.body || {}).scrobble === 'boolean') { rec.scrobble = req.body.scrobble; await saveAcct(req.acct); }
        res.json({ ok: true });
    }));

    app.delete('/api/trackers/:svc', requireAuth, wrap(async (req, res) => {
        const svc = svcOf(req);
        if (!svc) return res.status(404).json({ error: 'Unknown service.' });
        if (req.acct.trackers && req.acct.trackers[svc]) { delete req.acct.trackers[svc]; await saveAcct(req.acct); }
        pending.delete(`${req.acct.id}:${svc}`);
        res.json({ ok: true });
    }));

    // What this screen is playing: { action: start|pause|stop, type, id, progress (0-100) }.
    app.post('/api/trackers/scrobble', requireAuth, wrap(async (req, res) => {
        const b = req.body || {};
        const action = ['start', 'pause', 'stop'].includes(b.action) ? b.action : null;
        const media = mediaOf(b.type, b.id);
        const progress = Math.max(0, Math.min(100, Number(b.progress) || 0));
        if (!action || !media) return res.json({ ok: true, sent: [] }); // not something a tracker knows (a link, a YouTube video)
        if (!allow(`ts:${req.acct.id}`, 90, 60000)) return res.status(429).json({ error: 'Slow down.' });
        const mine = req.acct.trackers || {};
        const sent = [];
        let dirty = false;
        await Promise.all(Object.keys(mine).filter(svc => configured(svc) && mine[svc].access && mine[svc].scrobble !== false && !mine[svc].expired).map(async svc => {
            const r = await scrobbleOne(svc, mine[svc], action, { ...media, progress: Math.round(progress * 10) / 10, app_version: APP_VERSION }, t => { Object.assign(mine[svc], t); dirty = true; }).catch(() => ({ ok: false }));
            if (r.ok) sent.push(svc);
            else if (r.expired) { mine[svc].expired = true; dirty = true; }
        }));
        if (dirty) { req.acct.trackers = mine; await saveAcct(req.acct); }
        res.json({ ok: true, sent });
    }));
}

module.exports = { mount, mediaOf, configured, _internal: { SERVICES } };
