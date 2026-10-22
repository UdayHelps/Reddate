// Reddate's own catalog: movies and series from TMDB, served by our server.
//
// It speaks the Stremio addon format (manifest + /catalog + /meta), so the app treats it like any
// other catalog addon, and stream addons keep working: every title is mapped to its IMDb id, which
// is what stream addons look up. The TMDB key stays on the server; results are cached so we make
// few requests to TMDB.
//
// Off unless TMDB_TOKEN is set (a TMDB "API Read Access Token", or a v3 API key). Data and images
// come from TMDB: "This product uses the TMDB API but is not endorsed or certified by TMDB."

const TOKEN = process.env.TMDB_TOKEN || '';
const BASE = (process.env.TMDB_BASE || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
const IMG = 'https://image.tmdb.org/t/p';
const enabled = Boolean(TOKEN);

const PAGE = 20; // TMDB returns 20 results a page

// ---------- cache (small, in memory) ----------
const cache = new Map(); // key -> { value, exp }
const inflight = new Map();
const MAX_ENTRIES = 3000;
async function cached(key, ttlMs, load) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = load().then(value => {
        cache.set(key, { value, exp: Date.now() + ttlMs });
        if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value); // drop the oldest
        return value;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
}
const HOUR = 3600 * 1000;

// ---------- TMDB ----------
async function tmdb(path, params = {}) {
    const url = new URL(BASE + path);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, String(v)); });
    const headers = { Accept: 'application/json' };
    if (TOKEN.startsWith('eyJ')) headers.Authorization = `Bearer ${TOKEN}`; // v4 read token
    else url.searchParams.set('api_key', TOKEN);                        // v3 key
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    return res.json();
}

const img = (path, size) => (path ? `${IMG}/${size}${path}` : undefined);
const year = d => (d ? String(d).slice(0, 4) : undefined);
const tmdbType = type => (type === 'series' ? 'tv' : 'movie');

// Genre names (TMDB ids differ a little between movies and TV).
const GENRES = {
    movie: { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, 'Science Fiction': 878, Thriller: 53, War: 10752, Western: 37 },
    tv: { 'Action & Adventure': 10759, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Kids: 10762, Mystery: 9648, Reality: 10764, 'Sci-Fi & Fantasy': 10765, 'War & Politics': 10768, Western: 37 }
};
// Streaming services (TMDB watch-provider ids). Availability depends on the region.
const PROVIDERS = { Netflix: 8, 'Prime Video': 9, 'Disney+': 337, 'Apple TV+': 350, Max: 1899, Hulu: 15, 'Paramount+': 531, Peacock: 386 };

function metaPreview(item, type) {
    const t = type || (item.media_type === 'tv' ? 'series' : 'movie');
    return {
        id: `tmdb:${t}:${item.id}`,
        type: t,
        name: item.title || item.name || 'Untitled',
        poster: img(item.poster_path, 'w342'),
        background: img(item.backdrop_path, 'w1280'),
        releaseInfo: year(item.release_date || item.first_air_date),
        imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
        description: item.overview || undefined
    };
}

// ---------- the addon manifest ----------
// A personal catalog link carries the viewer's choices (country and which rows) in the address, so it works in apps
// that can't pass settings (Stremio, Nuvio): /catalog/c/<choices>/manifest.json. Not a secret, just a setting.
const ROW_IDS = ['trending', 'top10', 'popular', 'top_rated', 'now_playing', 'on_the_air', 'upcoming', 'genre', 'provider', 'search'];
function parseCfg(s) {
    try {
        const j = JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));
        const r = /^[A-Z]{2}$/.test(j.r) ? j.r : 'US';
        const rows = Array.isArray(j.rows) ? j.rows.filter(x => ROW_IDS.includes(x)) : ROW_IDS;
        return { r, rows: rows.length ? rows : ROW_IDS };
    } catch (e) { return null; }
}

function manifest(cfg, base) {
    const catalog = (type, id, name, extra) => ({ type, id, name, ...(extra ? { extra } : {}) });
    const skip = [{ name: 'skip' }];
    const search = [{ name: 'search', isRequired: true }];
    const list = (type, id, name) => catalog(type, id, name, skip);
    return {
        id: 'xyz.reddate.catalog',
        version: '1.0.0',
        name: 'Reddate Catalog',
        description: cfg ? `Movies and series from TMDB, for ${cfg.r}.` : 'Movies and series from TMDB.',
        logo: `${base || ''}/icons/icon-512.png`,
        resources: ['catalog', 'meta'],
        types: ['movie', 'series'],
        idPrefixes: ['tmdb:'],
        catalogs: [
            list('movie', 'trending', 'Trending'),
            catalog('movie', 'top10', 'Top 10', [{ name: 'genre', isRequired: true, options: ['Today', ...Object.keys(PROVIDERS)] }]),
            list('movie', 'popular', 'Popular'),
            list('movie', 'top_rated', 'Top rated'),
            list('movie', 'now_playing', 'New in cinemas'),
            list('movie', 'upcoming', 'Coming soon'),
            catalog('movie', 'genre', 'By genre', [{ name: 'genre', isRequired: true, options: Object.keys(GENRES.movie) }, ...skip]),
            catalog('movie', 'provider', 'On streaming', [{ name: 'genre', isRequired: true, options: Object.keys(PROVIDERS) }, ...skip]),
            catalog('movie', 'search', 'Search', search),
            list('series', 'trending', 'Trending'),
            catalog('series', 'top10', 'Top 10', [{ name: 'genre', isRequired: true, options: ['Today', ...Object.keys(PROVIDERS)] }]),
            list('series', 'popular', 'Popular'),
            list('series', 'top_rated', 'Top rated'),
            list('series', 'on_the_air', 'On the air'),
            catalog('series', 'genre', 'By genre', [{ name: 'genre', isRequired: true, options: Object.keys(GENRES.tv) }, ...skip]),
            catalog('series', 'provider', 'On streaming', [{ name: 'genre', isRequired: true, options: Object.keys(PROVIDERS) }, ...skip]),
            catalog('series', 'search', 'Search', search)
        ].filter(c => !cfg || cfg.rows.includes(c.id))
    };
}

// ---------- catalogs ----------
async function catalogResults(type, id, extra, region) {
    const tt = tmdbType(type);
    const page = Math.floor((Number(extra.skip) || 0) / PAGE) + 1;
    if (page > 20) return [];
    const common = { language: 'en-US', page, region };
    let data;
    switch (id) {
        case 'trending': data = await tmdb(`/trending/${tt}/day`, { language: 'en-US', page }); break;
        case 'popular': case 'top_rated': data = await tmdb(`/${tt}/${id}`, common); break;
        case 'now_playing': case 'upcoming': if (tt !== 'movie') return []; data = await tmdb(`/movie/${id}`, common); break;
        case 'on_the_air': if (tt !== 'tv') return []; data = await tmdb('/tv/on_the_air', common); break;
        case 'genre': {
            const g = GENRES[tt][extra.genre];
            if (!g) return [];
            data = await tmdb(`/discover/${tt}`, { ...common, with_genres: g, sort_by: 'popularity.desc', 'vote_count.gte': 50 });
            break;
        }
        case 'provider': {
            const p = PROVIDERS[extra.genre];
            if (!p) return [];
            data = await tmdb(`/discover/${tt}`, { ...common, with_watch_providers: p, watch_region: region || 'US', sort_by: 'popularity.desc' });
            break;
        }
        case 'top10': {
            // The ten hottest titles right now: everywhere ("Today"), or on one streaming service in this region
            // (this week's trending titles that the service carries; topped up with its most popular ones).
            const which = extra.genre || 'Today';
            if (which === 'Today') {
                data = await tmdb(`/trending/${tt}/day`, { language: 'en-US' });
                return (data.results || []).filter(r => r.poster_path).slice(0, 10).map((r, i) => ({ ...metaPreview(r, type), rank: i + 1 }));
            }
            const p = PROVIDERS[which];
            if (!p) return [];
            const hot = await trendingOnServices(tt, region || 'US');
            const picked = hot.filter(h => h.providers.includes(p)).map(h => h.item);
            if (picked.length < 10) {
                const more = await tmdb(`/discover/${tt}`, { language: 'en-US', with_watch_providers: p, watch_region: region || 'US', with_watch_monetization_types: 'flatrate', sort_by: 'popularity.desc', 'vote_count.gte': 20 });
                const have = new Set(picked.map(x => x.id));
                (more.results || []).forEach(r => { if (!have.has(r.id)) picked.push(r); });
            }
            return picked.filter(r => r.poster_path).slice(0, 10).map((r, i) => ({ ...metaPreview(r, type), rank: i + 1 }));
        }
        case 'search': {
            const q = String(extra.search || '').trim().slice(0, 100);
            if (!q) return [];
            data = await tmdb(`/search/${tt}`, { language: 'en-US', query: q, page: 1, include_adult: 'false' });
            break;
        }
        default: return [];
    }
    return (data.results || []).filter(r => r.poster_path).map(r => metaPreview(r, type));
}

// This week's trending titles with the flat-rate services that carry each in a region (cached for hours).
async function trendingOnServices(tt, region) {
    return cached(`hot:${tt}:${region}`, 4 * HOUR, async () => {
        const pages = await Promise.all([1, 2, 3, 4].map(page => tmdb(`/trending/${tt}/week`, { language: 'en-US', page }).catch(() => ({ results: [] }))));
        const items = pages.flatMap(d => d.results || []).filter((r, i, a) => r.poster_path && a.findIndex(x => x.id === r.id) === i);
        const out = [];
        let next = 0;
        await Promise.all(Array.from({ length: 8 }, async () => {
            while (next < items.length) {
                const item = items[next++];
                try {
                    const w = await tmdb(`/${tt}/${item.id}/watch/providers`);
                    const r = (w.results || {})[region] || {};
                    out.push({ item, order: items.indexOf(item), providers: (r.flatrate || []).map(x => x.provider_id) });
                } catch (e) { /* skip this title */ }
            }
        }));
        return out.sort((a, b) => a.order - b.order);
    });
}

// The services' own logos (from TMDB's watch-provider data), by the names above.
async function providerLogos() {
    return cached('provider-logos', 24 * HOUR, async () => {
        const d = await tmdb('/watch/providers/tv', { watch_region: 'US', language: 'en-US' });
        const byId = new Map((d.results || []).map(r => [r.provider_id, r.logo_path]));
        const out = {};
        Object.entries(PROVIDERS).forEach(([name, id]) => { const l = byId.get(id); if (l) out[name] = img(l, 'w154'); });
        return out;
    });
}

// ---------- full details for one title ----------
async function seasonEpisodes(tvId, season) {
    return cached(`season:${tvId}:${season}`, 12 * HOUR, () => tmdb(`/tv/${tvId}/season/${season}`, { language: 'en-US' }));
}

async function meta(type, id) {
    const m = /^tmdb:(movie|series):(\d+)$/.exec(id);
    if (!m || m[1] !== type) return null;
    const tt = tmdbType(type);
    const d = await tmdb(`/${tt}/${m[2]}`, { language: 'en-US', append_to_response: 'external_ids,credits,videos,similar,content_ratings,release_dates' });
    const imdb = d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || null;
    const trailer = ((d.videos && d.videos.results) || []).find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
        ((d.videos && d.videos.results) || []).find(v => v.site === 'YouTube');
    const out = {
        ...metaPreview(d, type),
        id,
        imdb_id: imdb, // stream addons look titles up by IMDb id
        genres: (d.genres || []).map(g => g.name),
        runtime: d.runtime ? `${d.runtime} min` : (d.episode_run_time && d.episode_run_time[0] ? `${d.episode_run_time[0]} min` : undefined),
        cast: ((d.credits && d.credits.cast) || []).slice(0, 10).map(c => c.name),
        director: ((d.credits && d.credits.crew) || []).filter(c => c.job === 'Director').map(c => c.name).slice(0, 3),
        trailers: trailer ? [{ source: trailer.key, type: 'Trailer' }] : [],
        similar: ((d.similar && d.similar.results) || []).filter(r => r.poster_path).slice(0, 12).map(r => metaPreview(r, type))
    };
    if (type === 'series') {
        const seasons = (d.seasons || []).filter(s => s.season_number > 0 && s.episode_count > 0).map(s => s.season_number).slice(0, 40);
        const results = [];
        // A few seasons at a time, so a long-running show doesn't fire dozens of requests at once.
        for (let i = 0; i < seasons.length; i += 5) {
            results.push(...await Promise.all(seasons.slice(i, i + 5).map(n => seasonEpisodes(m[2], n).catch(() => null))));
        }
        out.videos = [];
        results.forEach(s => (s && s.episodes || []).forEach(e => {
            out.videos.push({
                // Stream addons expect "tt1234567:season:episode".
                id: imdb ? `${imdb}:${e.season_number}:${e.episode_number}` : `${id}:${e.season_number}:${e.episode_number}`,
                title: e.name || `Episode ${e.episode_number}`,
                season: e.season_number,
                episode: e.episode_number,
                released: e.air_date ? new Date(e.air_date).toISOString() : undefined,
                thumbnail: img(e.still_path, 'w300'),
                overview: e.overview || undefined,
                rating: e.vote_average && e.vote_count ? Number(e.vote_average).toFixed(1) : undefined,
                runtime: e.runtime ? `${e.runtime} min` : undefined
            });
        }));
    }
    return out;
}

// Stremio passes extras in the path: /catalog/movie/genre/genre=Action&skip=20.json
function parseExtra(raw) {
    const out = {};
    if (!raw) return out;
    String(raw).split('&').forEach(pair => {
        const i = pair.indexOf('=');
        if (i > 0) out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
    });
    return out;
}

// ---------- cast & crew (with photos) for any title, found by IMDb id ----------
async function credits(type, id) {
    const tt = tmdbType(type);
    let tmdbId = (/^tmdb:(?:movie|series):(\d+)$/.exec(id) || [])[1];
    if (!tmdbId && /^tt\d+$/.test(id)) {
        const f = await tmdb(`/find/${id}`, { external_source: 'imdb_id' });
        const hit = (tt === 'tv' ? f.tv_results : f.movie_results) || [];
        tmdbId = hit[0] && hit[0].id;
    }
    if (!tmdbId) return null;
    const d = await tmdb(`/${tt}/${tmdbId}`, { language: 'en-US', append_to_response: tt === 'tv' ? 'aggregate_credits' : 'credits' });
    const c = (tt === 'tv' ? d.aggregate_credits : d.credits) || {};
    const cast = (c.cast || []).slice(0, 16).map(p => ({
        name: p.name,
        role: (p.character || (p.roles && p.roles[0] && p.roles[0].character) || '').slice(0, 60),
        photo: img(p.profile_path, 'w185') || ''
    })).filter(p => p.name);
    const crew = c.crew || [];
    const names = (jobs, n) => [...new Set(crew.filter(p => (p.jobs ? p.jobs.some(j => jobs.includes(j.job)) : jobs.includes(p.job))).map(p => p.name))].slice(0, n);
    const groups = [];
    if (tt === 'tv') {
        const creators = (d.created_by || []).map(p => p.name).slice(0, 3);
        if (creators.length) groups.push({ job: 'Created by', names: creators });
    } else {
        const dir = names(['Director'], 3);
        if (dir.length) groups.push({ job: dir.length > 1 ? 'Directors' : 'Director', names: dir });
        const writers = names(['Screenplay', 'Writer', 'Story', 'Novel'], 3);
        if (writers.length) groups.push({ job: 'Writers', names: writers });
    }
    const producers = names(tt === 'tv' ? ['Executive Producer'] : ['Producer'], 3);
    if (producers.length) groups.push({ job: tt === 'tv' ? 'Executive producers' : 'Producers', names: producers });
    const music = names(['Original Music Composer', 'Music'], 1);
    if (music.length) groups.push({ job: 'Music', names: music });
    return { cast, crew: groups };
}

// ---------- upcoming releases (the Calendar) ----------
// Three lists for one country: films in cinemas, films arriving digitally (VOD / rent / buy), and series with a new episode or a
// premiere. TMDB's release types: 1 premiere, 2 limited cinema, 3 cinema, 4 digital, 5 physical, 6 TV.
const ymd = d => d.toISOString().slice(0, 10);
async function pool(items, limit, fn) {
    const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } }
    }));
    return out;
}
async function movieDates(region, types, from, to) {
    // Films with a release of these types in the window, most popular first; then each film's own date. "WW" is worldwide: any
    // country counts and the earliest date in the window wins. Otherwise only that country's release dates are used.
    const ww = region === 'WW';
    const found = [];
    for (let page = 1; page <= 2; page++) {
        const r = await tmdb('/discover/movie', { ...(ww ? {} : { region }), with_release_type: types.join('|'), 'release_date.gte': from, 'release_date.lte': to, sort_by: 'popularity.desc', page, include_adult: 'false' });
        found.push(...(r.results || []));
        if (page >= (r.total_pages || 1)) break;
    }
    const top = found.filter(m => m.poster_path).slice(0, 28);
    const dated = await pool(top, 8, async m => {
        const rd = await cached(`reldates:${m.id}`, 6 * HOUR, () => tmdb(`/movie/${m.id}/release_dates`));
        const places = (rd.results || []).filter(x => ww || x.iso_3166_1 === region);
        const dates = places.flatMap(x => x.release_dates || []).filter(x => types.includes(x.type)).map(x => String(x.release_date).slice(0, 10)).filter(d => d >= from && d <= to).sort();
        return dates.length ? { item: m, date: dates[0] } : null;
    });
    return dated.filter(Boolean);
}
async function calendarData(region, days) {
    const today = new Date(); const from = ymd(today); const to = ymd(new Date(today.getTime() + days * 86400000));
    const [cinema, digital, tv] = await Promise.all([
        movieDates(region, [2, 3], from, to),
        movieDates(region, [4], from, to),
        (async () => {
            const r = await tmdb('/discover/tv', { 'air_date.gte': from, 'air_date.lte': to, sort_by: 'popularity.desc', without_genres: '10767,10763,10766', ...(region === 'WW' ? {} : { watch_region: region }), include_adult: 'false' }); // no daily talk shows, news or soaps
            const shows = (r.results || []).filter(x => x.poster_path).slice(0, 26);
            const rows = await pool(shows, 8, async sh => {
                const d = await cached(`tvnext:${sh.id}`, 3 * HOUR, () => tmdb(`/tv/${sh.id}`));
                const ep = [d.next_episode_to_air, d.last_episode_to_air].find(e => e && e.air_date && e.air_date >= from && e.air_date <= to);
                return ep ? { item: sh, date: ep.air_date, ep } : null;
            });
            return rows.filter(Boolean);
        })()
    ]);
    const card = (x, kind, type, note) => ({ ...metaPreview(x.item, type), calDate: x.date, calKind: kind, calNote: note });
    const byDate = (a, b) => (a.calDate < b.calDate ? -1 : a.calDate > b.calDate ? 1 : 0);
    return {
        region, from, to,
        cinema: cinema.map(x => card(x, 'cinema', 'movie', 'In cinemas')).sort(byDate),
        digital: digital.map(x => card(x, 'digital', 'movie', 'Digital release')).sort(byDate),
        tv: tv.map(x => card(x, 'tv', 'series', `S${x.ep.season_number} E${x.ep.episode_number}${x.ep.episode_number === 1 ? ' · Premiere' : ''}${x.ep.name ? ' · ' + x.ep.name : ''}`)).sort(byDate)
    };
}

function mount(app) {
    // Lets the page know whether to use this catalog (and with what attribution).
    app.get('/api/catalog/config', (_req, res) => res.json({ enabled, manifest: enabled ? '/catalog/manifest.json' : null }));
    if (!enabled) return;

    // Per-IP limits, so nobody can burn through our TMDB allowance by asking for thousands of uncached titles.
    const hits = new Map();
    const tooMany = (req, res, kind, max) => {
        const now = Date.now(), k = `${kind}:${req.ip}`, h = hits.get(k);
        if (!h || h.resetAt < now) { hits.set(k, { count: 1, resetAt: now + 60000 }); if (hits.size > 20000) hits.clear(); return false; }
        if (++h.count <= max) return false;
        res.status(429).json({ error: 'Slow down.' });
        return true;
    };
    const send = (res, body, maxAgeSec) => res.set('Cache-Control', `public, max-age=${maxAgeSec}`).set('Access-Control-Allow-Origin', '*').json(body);
    const region = req => (/^[A-Z]{2}$/.test(req.query.region || '') ? req.query.region : 'US');
    const calRegion = req => (req.query.region === 'WW' ? 'WW' : region(req)); // the Calendar is worldwide unless a country is asked for

    // The same three routes serve the default catalog (/catalog/...) and a personal one (/catalog/c/<choices>/...).
    const cfgOf = req => (req.params.cfg ? parseCfg(req.params.cfg) : null);
    const regionOf = req => { const c = cfgOf(req); return c ? c.r : region(req); };
    const baseOf = req => `${req.protocol}://${req.get('host')}`;
    app.get(['/catalog/manifest.json', '/catalog/c/:cfg/manifest.json'], (req, res) => send(res, manifest(cfgOf(req), baseOf(req)), 3600));

    app.get(['/catalog/catalog/:type/:id.json', '/catalog/catalog/:type/:id/:extra.json', '/catalog/c/:cfg/catalog/:type/:id.json', '/catalog/c/:cfg/catalog/:type/:id/:extra.json'], async (req, res) => {
        if (tooMany(req, res, 'cat', 240)) return;
        const { type, id } = req.params;
        if (type !== 'movie' && type !== 'series') return res.status(404).json({ metas: [] });
        const cfg = cfgOf(req);
        if (cfg && !cfg.rows.includes(id)) return res.json({ metas: [] });
        const extra = parseExtra(req.params.extra);
        const key = `cat:${type}:${id}:${req.params.extra || ''}:${regionOf(req)}`;
        try {
            const metas = await cached(key, id === 'search' ? HOUR : 3 * HOUR, () => catalogResults(type, id, extra, regionOf(req)));
            const body = { metas };
            if (id === 'top10') {
                try { const logos = await providerLogos(); if (logos[extra.genre]) body.logo = logos[extra.genre]; } catch (e) { /* no logo is fine */ }
                body.ranked = true;
            }
            send(res, body, id === 'search' ? 600 : 1800);
        } catch (e) {
            console.warn('catalog:', e.message);
            res.status(502).json({ metas: [], error: 'Catalog is unavailable right now.' });
        }
    });


    // Upcoming releases for a country: in cinemas, digital / VOD, and new TV episodes.
    app.get('/api/calendar', async (req, res) => {
        if (tooMany(req, res, 'cal', 30)) return;
        const rg = calRegion(req);
        const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 45));
        try {
            const body = await cached(`calendar:${rg}:${days}:${ymd(new Date())}`, 3 * HOUR, () => calendarData(rg, days));
            res.set('Cache-Control', 'public, max-age=1800').json(body);
        } catch (e) {
            console.warn('calendar:', e.message);
            res.status(502).json({ error: 'The calendar is unavailable right now.' });
        }
    });

    // An actor or crew member: their picture and their best-known titles (TV app → cast → a person).
    app.get('/api/person', async (req, res) => {
        if (tooMany(req, res, 'person', 60)) return;
        const name = String(req.query.name || '').trim().slice(0, 80);
        if (name.length < 2) return res.status(400).json({ name, metas: [] });
        try {
            const p = await cached(`person:${name.toLowerCase()}`, 24 * HOUR, async () => {
                const hit = ((await tmdb('/search/person', { query: name, language: 'en-US' })).results || [])[0];
                if (!hit) return { name, photo: '', known: '', metas: [] };
                const c = await tmdb(`/person/${hit.id}/combined_credits`, { language: 'en-US' });
                const seen = new Set();
                const metas = [...(c.cast || []), ...(c.crew || [])]
                    // their own work only: no talk shows, news or reality TV, and no "Himself" appearances
                    .filter(x => !(x.genre_ids || []).some(g => g === 10767 || g === 10763 || g === 10764) && !/^(him|her|them)?self\b/i.test(String(x.character || '').trim()))
                    .filter(x => (x.media_type === 'movie' || x.media_type === 'tv') && x.poster_path && !seen.has(x.media_type + x.id) && seen.add(x.media_type + x.id))
                    .filter(x => x.media_type !== 'tv' || !x.episode_count || x.episode_count >= 3) // a guest spot isn't their work
                    .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
                    .slice(0, 30)
                    .map(x => metaPreview(x));
                return { name: hit.name, photo: img(hit.profile_path, 'w342') || '', known: hit.known_for_department || '', metas };
            });
            send(res, p, 3600);
        } catch (e) {
            console.warn('person:', e.message);
            res.status(502).json({ name, metas: [] });
        }
    });

    app.get('/api/credits/:type/:id', async (req, res) => {
        if (tooMany(req, res, 'credits', 60)) return;
        const { type, id } = req.params;
        if ((type !== 'movie' && type !== 'series') || !/^(tt\d{3,12}|tmdb:(movie|series):\d{1,10})$/.test(id)) return res.status(400).json({ cast: [], crew: [] });
        try {
            const c = await cached(`credits:${type}:${id}`, 24 * HOUR, () => credits(type, id));
            send(res, c || { cast: [], crew: [] }, 3600);
        } catch (e) {
            console.warn('credits:', e.message);
            res.status(502).json({ cast: [], crew: [] });
        }
    });

    app.get(['/catalog/meta/:type/:id.json', '/catalog/c/:cfg/meta/:type/:id.json'], async (req, res) => {
        if (tooMany(req, res, 'meta', 120)) return;
        const { type, id } = req.params;
        try {
            const m = await cached(`meta:${type}:${id}`, 24 * HOUR, () => meta(type, id));
            if (!m) return res.status(404).json({ meta: null });
            send(res, { meta: m }, 3600);
        } catch (e) {
            console.warn('catalog meta:', e.message);
            res.status(502).json({ meta: null, error: 'Details are unavailable right now.' });
        }
    });
}

module.exports = { enabled, mount, _internal: { manifest, parseExtra, parseCfg, ROW_IDS, GENRES, PROVIDERS } };
