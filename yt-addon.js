// Reddate YT: a YouTube addon in the standard Stremio format, so the same link works in Reddate, Nuvio and Stremio.
// Everyone brings their own YouTube API key (pasted on /yt); it travels inside their install link, encrypted, and is
// only ever used to ask Google for public data (trending, categories, search, video details). Videos play in the
// app's own YouTube player (`ytId`), so nothing is downloaded or proxied here.
const crypto = require('crypto');
const path = require('path');

const LOG_MODE = process.env.MAIL_MODE === 'log';
// On a development machine a local stand-in can answer instead of Google (testing without a real key).
const API = (LOG_MODE && process.env.YT_API_BASE) || 'https://www.googleapis.com/youtube/v3';
// The settings in a link are sealed with a key only this server knows (derived from the vault secret).
const SEAL_KEY = crypto.createHash('sha256').update('reddate-yt:' + (process.env.VAULT_SECRET || (LOG_MODE ? 'dev-only-not-a-secret' : crypto.randomBytes(32).toString('hex')))).digest();

const REGIONS = ['US', 'IN', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'BR', 'MX', 'JP', 'KR', 'ID', 'PH', 'PK', 'BD', 'AE', 'SA', 'NG', 'ZA', 'NL', 'SE', 'TR', 'RU', 'PL', 'AR', 'NZ', 'SG', 'MY'];
const CATALOGS = [
    // YouTube category ids (videos.list videoCategoryId): 1 Film & Animation, 2 Autos,
    // 10 Music, 15 Pets & Animals, 17 Sports, 20 Gaming, 22 People & Blogs,
    // 23 Comedy, 24 Entertainment, 25 News & Politics, 26 Howto & Style,
    // 27 Education, 28 Science & Technology.
    { id: 'yt_trending', name: 'Trending on YouTube' },
    { id: 'yt_music', name: 'Music', cat: '10' },
    { id: 'yt_gaming', name: 'Gaming', cat: '20' },
    { id: 'yt_news', name: 'News', cat: '25' },
    { id: 'yt_sports', name: 'Sports', cat: '17' },
    { id: 'yt_comedy', name: 'Comedy', cat: '23' },
    { id: 'yt_entertainment', name: 'Entertainment', cat: '24' },
    { id: 'yt_film', name: 'Film & animation', cat: '1' },
    { id: 'yt_howto', name: 'How-to & style', cat: '26' },
    { id: 'yt_education', name: 'Education', cat: '27' },
    { id: 'yt_science', name: 'Science & technology', cat: '28' },
    // Live now: search with eventType=live (the mostPopular chart cannot filter live).
    { id: 'yt_live', name: 'Live now', live: true },
    { id: 'yt_search', name: 'YouTube', search: true },
    // Channels come up in search too: open one and its uploads are the "episodes", newest first.
    { id: 'yt_channels', name: 'YouTube channels', search: true, type: 'channel' },
    // A playlist opens like a show: the playlist is the series, its videos the episodes, in playlist order.
    { id: 'yt_playlists', name: 'Playlists', search: true, type: 'series' }
];

function seal(cfg) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', SEAL_KEY, iv);
    const body = Buffer.concat([c.update(JSON.stringify(cfg), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}
function unseal(s) {
    try {
        const b = Buffer.from(String(s), 'base64url');
        if (b.length < 29) return null;
        const d = crypto.createDecipheriv('aes-256-gcm', SEAL_KEY, b.subarray(0, 12));
        d.setAuthTag(b.subarray(12, 28));
        const cfg = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
        return cfg && typeof cfg.k === 'string' ? cfg : null;
    } catch (e) { return null; }
}

// Public results are the same for everyone, so one person's request answers the next person's for a while:
// keyed by what was asked (never by whose key asked).
const cache = new Map(); // what -> { at, data }
function cached(what, ttl) { const h = cache.get(what); return h && Date.now() - h.at < ttl ? h.data : null; }
function remember(what, data) {
    cache.set(what, { at: Date.now(), data });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
}

class KeyError extends Error {}
async function yt(key, endpoint, params, ttl) {
    const what = `${endpoint}?${new URLSearchParams(params)}`;
    const hit = cached(what, ttl);
    if (hit) return hit;
    const res = await fetch(`${API}/${endpoint}?${new URLSearchParams({ ...params, key })}`, { signal: AbortSignal.timeout(12000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const reason = data && data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason || `HTTP ${res.status}`;
        throw new KeyError(reason);
    }
    remember(what, data);
    return data;
}

// Video length the way YouTube shows it: 4:13, 1:02:03 (empty for live streams).
const duration = iso => {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
    if (!m || iso === 'P0D') return '';
    const h = +m[1] || 0, mi = +m[2] || 0, s = +m[3] || 0;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`;
};
const views = n => { n = +n || 0; return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B views` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M views` : n >= 1e3 ? `${Math.round(n / 1e3)}K views` : n ? `${n} views` : ''; };

function toMeta(v, full) {
    const sn = v.snippet || {}, th = sn.thumbnails || {};
    const big = (th.maxres || th.standard || th.high || th.medium || th.default || {}).url || '';
    const card = (th.high || th.medium || th.default || {}).url || big;
    const desc = sn.description || '';
    return {
        id: `yt:${v.id}`,
        type: 'movie',
        name: sn.title || 'YouTube video',
        posterShape: 'landscape',
        poster: card,
        background: big,
        // Views and length are what people pick YouTube videos by: views in releaseInfo, length in runtime, so
        // Reddate, Stremio and Nuvio all show them. The channel and upload date head the description.
        description: [[sn.channelTitle, (sn.publishedAt || '').slice(0, 10)].filter(Boolean).join(' · '), full ? desc : desc.slice(0, 280)].filter(Boolean).join('\n\n'),
        releaseInfo: views(v.statistics && v.statistics.viewCount),
        released: sn.publishedAt || undefined,
        runtime: duration(v.contentDetails && v.contentDetails.duration),
        genres: [sn.channelTitle].filter(Boolean),
        links: sn.channelTitle ? [{ name: sn.channelTitle, category: 'Channel', url: `https://www.youtube.com/channel/${sn.channelId}` }] : undefined,
        behaviorHints: { defaultVideoId: `yt:${v.id}` }
    };
}

const subs = n => { n = +n || 0; return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B subscribers` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M subscribers` : n >= 1e3 ? `${Math.round(n / 1e3)}K subscribers` : n ? `${n} subscribers` : ''; };

// A channel (Stremio's "channel" type) opens like a show: its picture, subscribers under the name, and (in the full version) its uploads.
function channelMeta(c, uploads) {
    const sn = c.snippet || {}, th = sn.thumbnails || {}, st = c.statistics || {};
    const pic = (th.high || th.medium || th.default || {}).url || '';
    const banner = (((c.brandingSettings || {}).image || {}).bannerExternalUrl) || '';
    const n = uploads ? uploads.length : 0;
    return {
        id: `ytc:${c.id}`,
        type: 'channel',
        name: sn.title || 'YouTube channel',
        posterShape: 'square',
        poster: pic,
        logo: pic,
        background: banner ? `${banner}=w1920` : pic,
        releaseInfo: st.hiddenSubscriberCount ? '' : subs(st.subscriberCount),
        description: [st.hiddenSubscriberCount ? '' : subs(st.subscriberCount), st.videoCount ? `${Number(st.videoCount).toLocaleString('en-US')} videos` : ''].filter(Boolean).join(' · ') + (sn.description ? `\n\n${sn.description.slice(0, 600)}` : ''),
        genres: ['YouTube channel'],
        links: [{ name: 'Open on YouTube', category: 'Channel', url: `https://www.youtube.com/channel/${c.id}` }],
        ...(uploads ? {
            // Newest first: episode 1 is the latest upload.
            videos: uploads.map((v, i) => {
                const m = toMeta(v);
                return { id: m.id, title: m.name, name: m.name, season: 1, episode: i + 1, released: m.released, thumbnail: m.poster,
                    overview: m.releaseInfo, runtime: m.runtime };
            }),
            behaviorHints: { defaultVideoId: n ? `yt:${uploads[0].id}` : undefined }
        } : {})
    };
}

// A channel's uploads, newest first (up to 200), with views and length.
async function channelUploads(key, ch) {
    const list = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;
    if (!list) return [];
    const ids = [];
    let page = '';
    for (let i = 0; i < 4; i++) {
        const r = await yt(key, 'playlistItems', { part: 'contentDetails', playlistId: list, maxResults: '50', ...(page ? { pageToken: page } : {}) }, 3600e3);
        (r.items || []).forEach(x => { if (x.contentDetails && x.contentDetails.videoId) ids.push(x.contentDetails.videoId); });
        page = r.nextPageToken;
        if (!page) break;
    }
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
        const v = await yt(key, 'videos', { part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(',') }, 3600e3);
        out.push(...(v.items || []));
    }
    return out.sort((a, b) => String((b.snippet || {}).publishedAt).localeCompare(String((a.snippet || {}).publishedAt)));
}

// A playlist is a series: its videos are the episodes, kept in the playlist's own order.
function playlistCard(p) {
    const sn = p.snippet || {}, th = sn.thumbnails || {};
    const pic = (th.high || th.medium || th.default || {}).url || '';
    const count = (p.contentDetails && p.contentDetails.itemCount) || 0;
    return {
        id: `ytp:${p.id}`,
        type: 'series',
        name: sn.title || 'YouTube playlist',
        posterShape: 'landscape',
        poster: pic,
        background: pic,
        releaseInfo: count ? `${count} videos` : '',
        description: [sn.channelTitle, count ? `${count} videos` : ''].filter(Boolean).join(' · '),
        genres: [sn.channelTitle].filter(Boolean)
    };
}

function playlistMeta(p, items) {
    const sn = p.snippet || {}, th = sn.thumbnails || {};
    const pic = (th.high || th.medium || th.default || {}).url || '';
    const count = items.length || (p.contentDetails && p.contentDetails.itemCount) || 0;
    return {
        ...playlistCard(p),
        // Each video is an episode; its id points at the video, so the existing stream route plays it.
        videos: items.map((v, i) => {
            const m = toMeta(v);
            return { id: m.id, title: m.name, name: m.name, season: 1, episode: i + 1, released: m.released, thumbnail: m.poster,
                overview: m.releaseInfo, runtime: m.runtime };
        }),
        behaviorHints: { defaultVideoId: items.length ? `yt:${items[0].id}` : undefined }
    };
}

// A playlist's videos in its own order (up to 200).
async function playlistVideos(key, playlistId) {
    const ids = [];
    let page = '';
    for (let i = 0; i < 4; i++) {
        const r = await yt(key, 'playlistItems', { part: 'contentDetails', playlistId, maxResults: '50', ...(page ? { pageToken: page } : {}) }, 3600e3);
        (r.items || []).forEach(x => { if (x.contentDetails && x.contentDetails.videoId) ids.push(x.contentDetails.videoId); });
        page = r.nextPageToken;
        if (!page) break;
    }
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
        const v = await yt(key, 'videos', { part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(',') }, 3600e3);
        out.push(...(v.items || []));
    }
    // Keep the playlist's order, not the order Google hands the videos back in.
    const byId = new Map(out.map(v => [v.id, v]));
    return ids.map(id => byId.get(id)).filter(Boolean);
}

function manifest(cfg, base) {
    const config = [{
        key: 'youtubetoken',
        type: 'password',
        title: 'YouTube API key',
        required: true,
        description: 'Your YouTube Data API v3 key. Get one at https://console.developers.google.com/',
        isSensitive: true
    }];
    return {
        id: 'xyz.reddate.yt',
        version: '1.2.0',
        name: 'Reddate YT',
        description: cfg ? 'YouTube trending, music, gaming, news and search. Plays in the app’s YouTube player.' : 'YouTube in your app. Open the setup page to add your free YouTube API key.',
        descriptionNoConfig: 'YouTube in your app. Open the setup page to add your free YouTube API key.',
        background: `${base}/yt/bg.jpg`,
        logo: `${base}/yt/logo.png?v=2`,
        contactEmail: 'support@reddate.xyz',
        resources: [
            { name: 'catalog', types: ['movie', 'series', 'channel'] },
            { name: 'meta', types: ['movie', 'series', 'channel'], idPrefixes: ['yt:', 'ytc:', 'ytp:'] },
            { name: 'stream', types: ['movie', 'series', 'channel'], idPrefixes: ['yt:', 'ytc:', 'ytp:'] }
        ],
        types: ['movie', 'series', 'channel', 'tv'],
        idPrefixes: ['yt:', 'ytc:', 'ytp:'],
        catalogs: cfg ? CATALOGS.filter(c => !Array.isArray(cfg.w) || cfg.w.includes(c.id)).map(c => ({ type: c.type || 'movie', id: c.id, name: c.name, ...(c.search ? { extra: [{ name: 'search', isRequired: true }] } : {}) })) : [],
        behaviorHints: {
            configurable: true,
            configurationRequired: !cfg
        },
        config: cfg ? [] : config
    };
}

function register(app) {
    const page = path.join(__dirname, 'tv-site', 'yt.html');
    app.get(['/yt', '/yt/', '/yt/configure', '/yt/:cfg/configure'], (_req, res) => res.redirect(302, '/addon-list#yt'));
    // The rows this addon can add, for the setup page's choices.
    app.get('/yt/api/rows', (_req, res) => res.json({ rows: CATALOGS.map(c => ({ id: c.id, name: c.name, search: !!c.search })) }));
    app.get('/yt/bg.jpg', (_req, res) => res.sendFile(path.join(__dirname, 'tv-site', 'assets', 'hero-home.jpg')));
    app.get('/yt/logo.png', (_req, res) => res.sendFile(path.join(__dirname, 'tv-site', 'assets', 'yt-logo.png')));

    // Check a pasted key (one cheap request) and hand back the install link.
    app.post('/yt/api/link', require('express').json({ limit: '2kb' }), async (req, res) => {
        const key = String((req.body && req.body.key) || '').trim();
        const region = REGIONS.includes(String(req.body && req.body.region)) ? req.body.region : 'US';
        // Which rows to add (omitted means all). Only known row ids are kept, in the addon's own order.
        const asked = req.body && Array.isArray(req.body.rows) ? req.body.rows.map(String) : null;
        const rows = asked ? CATALOGS.map(c => c.id).filter(id => asked.includes(id)) : null;
        if (rows && !rows.length) return res.status(400).json({ ok: false, message: 'Pick at least one row to add.' });
        if (!/^[\w-]{30,60}$/.test(key)) return res.status(400).json({ ok: false, message: 'That doesn’t look like an API key. It starts with “AIza” and is about 39 characters long.' });
        try {
            const r = await fetch(`${API}/videos?part=id&chart=mostPopular&maxResults=1&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10000) });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                const reason = d && d.error && d.error.errors && d.error.errors[0] && d.error.errors[0].reason || '';
                const message = reason === 'accessNotConfigured' ? 'The key is fine, but YouTube isn’t turned on for it yet. Open “Turn on YouTube”, press Enable, wait a minute, then try again.'
                    : reason === 'quotaExceeded' ? 'This key has used today’s free allowance. Try again tomorrow, or make a new key.'
                    : 'Google says this key isn’t valid. Copy it again from the “Make your key” page.';
                return res.json({ ok: false, message });
            }
        } catch (e) { return res.json({ ok: false, message: 'Couldn’t reach YouTube to check the key. Try again in a moment.' }); }
        const token = seal({ k: key, r: region, ...(rows && rows.length < CATALOGS.length ? { w: rows } : {}) });
        const base = `${req.protocol}://${req.get('host')}`;
        res.json({ ok: true, manifest: `${base}/yt/${token}/manifest.json` });
    });

    // Addon apps fetch these from anywhere (Stremio, Nuvio, browsers): open to every origin.
    const cors = (_req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); };
    const baseOf = req => `${req.protocol}://${req.get('host')}`;

    app.get('/yt/manifest.json', cors, (req, res) => res.json(manifest(null, baseOf(req))));
    app.get('/yt/:cfg/manifest.json', cors, (req, res) => {
        const cfg = unseal(req.params.cfg);
        res.set('Cache-Control', 'public, max-age=600'); // short, so new rows (like Channels) reach apps soon
        res.json(manifest(cfg, baseOf(req)));
    });

    app.get('/yt/:cfg/catalog/:type/:id/:extra?.json', cors, async (req, res) => {
        const cfg = unseal(req.params.cfg);
        const c = CATALOGS.find(x => x.id === req.params.id);
        if (!cfg || !c) return res.json({ metas: [] });
        try {
            if (c.search) {
                const q = (new URLSearchParams(req.params.extra || '').get('search') || '').trim().slice(0, 100);
                if (!q) return res.json({ metas: [] });
                if (c.id === 'yt_channels') {
                    const found = await yt(cfg.k, 'search', { part: 'snippet', type: 'channel', maxResults: '12', q, regionCode: cfg.r || 'US', safeSearch: 'moderate' }, 6 * 3600e3);
                    const ids = (found.items || []).map(i => i.id && i.id.channelId).filter(Boolean);
                    if (!ids.length) return res.json({ metas: [] });
                    const ch = await yt(cfg.k, 'channels', { part: 'snippet,statistics', id: ids.join(',') }, 6 * 3600e3);
                    const byId = new Map((ch.items || []).map(x => [x.id, x]));
                    res.set('Cache-Control', 'public, max-age=3600');
                    return res.json({ metas: ids.map(id => byId.get(id)).filter(Boolean).map(x => channelMeta(x)) });
                }
                if (c.id === 'yt_playlists') {
                    // search.list only takes part=snippet (and gives the id as an object); the video counts come from playlists.list.
                    const found = await yt(cfg.k, 'search', { part: 'snippet', type: 'playlist', maxResults: '25', q, regionCode: cfg.r || 'US', safeSearch: 'moderate' }, 6 * 3600e3);
                    const ids = (found.items || []).map(i => i.id && i.id.playlistId).filter(Boolean);
                    if (!ids.length) return res.json({ metas: [] });
                    const full = await yt(cfg.k, 'playlists', { part: 'snippet,contentDetails', id: ids.join(','), maxResults: '25' }, 6 * 3600e3);
                    const byId = new Map((full.items || []).map(p => [p.id, p]));
                    const metas = ids.map(id => byId.get(id)).filter(Boolean).map(p => playlistCard(p));
                    res.set('Cache-Control', 'public, max-age=3600');
                    return res.json({ metas });
                }
                const found = await yt(cfg.k, 'search', { part: 'snippet', type: 'video', maxResults: '25', q, regionCode: cfg.r || 'US', safeSearch: 'moderate' }, 6 * 3600e3);
                const ids = (found.items || []).map(i => i.id && i.id.videoId).filter(Boolean);
                if (!ids.length) return res.json({ metas: [] });
                const v = await yt(cfg.k, 'videos', { part: 'snippet,contentDetails,statistics', id: ids.join(',') }, 6 * 3600e3);
                res.set('Cache-Control', 'public, max-age=3600');
                return res.json({ metas: (v.items || []).map(x => toMeta(x)) });
            }
            const params = { part: 'snippet,contentDetails,statistics', chart: 'mostPopular', regionCode: cfg.r || 'US', maxResults: '40' };
            if (c.cat) params.videoCategoryId = c.cat;
            const v = await yt(cfg.k, 'videos', params, 3 * 3600e3);
            res.set('Cache-Control', 'public, max-age=1800');
            res.json({ metas: (v.items || []).map(x => toMeta(x)) });
        } catch (e) {
            if (!(e instanceof KeyError)) console.warn('Reddate YT catalog failed:', e.message);
            res.json({ metas: [] });
        }
    });

    app.get('/yt/:cfg/meta/:type/:id.json', cors, async (req, res) => {
        const cfg = unseal(req.params.cfg);
        const id = decodeURIComponent(req.params.id);
        const chId = /^ytc:(UC[\w-]{22})$/.exec(id);
        if (cfg && chId) {
            try {
                const ch = await yt(cfg.k, 'channels', { part: 'snippet,statistics,contentDetails,brandingSettings', id: chId[1] }, 6 * 3600e3);
                const c = (ch.items || [])[0];
                if (!c) return res.json({ meta: null });
                const uploads = await channelUploads(cfg.k, c);
                res.set('Cache-Control', 'public, max-age=1800');
                return res.json({ meta: channelMeta(c, uploads) });
            } catch (e) { return res.json({ meta: null }); }
        }
        const m = /^yt:([\w-]{11})$/.exec(id);
        if (!cfg || !m) return res.json({ meta: null });
        try {
            const v = await yt(cfg.k, 'videos', { part: 'snippet,contentDetails,statistics', id: m[1] }, 24 * 3600e3);
            const it = (v.items || [])[0];
            res.set('Cache-Control', 'public, max-age=3600');
            res.json({ meta: it ? toMeta(it, true) : null });
        } catch (e) { res.json({ meta: null }); }
        const pId = /^ytp:([\w-]{22})$/.exec(id);
        if (cfg && pId) {
            try {
                const p = await yt(cfg.k, 'playlists', { part: 'snippet,contentDetails', id: pId[1] }, 6 * 3600e3);
                const pl = (p.items || [])[0];
                if (!pl) return res.json({ meta: null });
                const items = await playlistVideos(cfg.k, pId[1]);
                res.set('Cache-Control', 'public, max-age=1800');
                return res.json({ meta: playlistMeta(pl, items) });
            } catch (e) { return res.json({ meta: null }); }
        }
    });

    // Streams need no key: the video plays in the app's own YouTube player.
    app.get('/yt/:cfg/stream/:type/:id.json', cors, (req, res) => {
        const m = /^yt:([\w-]{11})$/.exec(decodeURIComponent(req.params.id));
        if (!m) return res.json({ streams: [] });
        res.set('Cache-Control', 'public, max-age=86400');
        res.json({ streams: [
            { name: 'YouTube', title: 'Plays in the YouTube player', ytId: m[1] },
            { name: 'YouTube', title: 'Open on YouTube', externalUrl: `https://www.youtube.com/watch?v=${m[1]}` }
        ] });
    });
}

module.exports = { register, REGIONS };
