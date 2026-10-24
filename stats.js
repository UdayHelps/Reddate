// Anonymous usage stats, stored in Upstash Redis (free tier) over its REST API.
//
// Privacy: only counts are kept — visits, unique visitors per day, rooms,
// joins, messages, videos started, feature use, peak concurrency. Never IPs,
// room IDs, chat, usernames, or what anyone watched. "Unique visitors" are
// counted in a HyperLogLog from a salted hash of IP + user-agent; the salt is
// random, kept only in memory and rotated daily, so a visitor can't be
// re-identified or followed across days.
//
// Upstash's free plan limits commands per month, so counts are summed in
// memory and written in one pipeline every FLUSH_MS (and on shutdown).
// Without UPSTASH_REDIS_REST_URL / _TOKEN every function is a no-op.

const crypto = require('crypto');

const URL_ = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
// Local development (MAIL_MODE=log) never writes into the live database, the same rule accounts.js follows. The
// developer's .env holds the real Upstash settings, so without this a test run (or a load test) counts as real visitors.
const enabled = Boolean(URL_ && TOKEN) && process.env.MAIL_MODE !== 'log';
// Each site keeps its own counters: set STATS_PREFIX (e.g. stats-xyz) when two services share one Redis.
const P = (process.env.STATS_PREFIX || 'stats').replace(/[^a-z0-9_-]/gi, '');
const FLUSH_MS = 30000;
const DAY_TTL = 400 * 24 * 3600; // keep daily keys ~13 months

// Every counter the stats page knows about, in display order.
const EVENTS = [
    'visits', 'rooms', 'joins', 'messages',
    'video_youtube', 'video_link', 'video_addon',
    'browse', 'addons_updated', 'gifs', 'calls',
    // Viewer watch time in seconds (2 friends × 1 hour = 2 hours), by source.
    'watch_addon', 'watch_youtube', 'watch_link'
];

const day = (d = new Date()) => d.toISOString().slice(0, 10); // UTC YYYY-MM-DD

let pending = new Map();      // `${day}|${event}` -> count
let pendingVisitors = new Map(); // day -> Set of hashes
let peakToday = { day: day(), value: 0 };
let peakWritten = { day: '', value: 0 };
let salt = { day: day(), value: crypto.randomBytes(32) };

async function redis(commands) {
    const res = await fetch(`${URL_}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    const out = await res.json();
    const err = out.find(r => r && r.error);
    if (err) throw new Error(`Upstash: ${err.error}`);
    return out.map(r => r.result);
}

function track(event, n = 1) {
    if (!enabled || !EVENTS.includes(event)) return;
    const key = `${day()}|${event}`;
    pending.set(key, (pending.get(key) || 0) + n);
}

// Counts a visit and the (anonymous) visitor behind it.
function trackVisit(ip, userAgent) {
    if (!enabled) return;
    track('visits');
    const today = day();
    if (salt.day !== today) salt = { day: today, value: crypto.randomBytes(32) };
    const hash = crypto.createHmac('sha256', salt.value).update(`${ip}|${userAgent || ''}`).digest('base64url').slice(0, 22);
    if (!pendingVisitors.has(today)) pendingVisitors.set(today, new Set());
    pendingVisitors.get(today).add(hash);
}

// Called whenever the number of connected people changes.
function observeOnline(count) {
    if (!enabled) return;
    const today = day();
    if (peakToday.day !== today) peakToday = { day: today, value: 0 };
    if (count > peakToday.value) peakToday.value = count;
}

// Raises a stored value only if the new one is bigger (peaks across restarts).
const RAISE_SCRIPT = "local c = tonumber(redis.call('GET', KEYS[1]) or '0') " +
    "if tonumber(ARGV[1]) > c then redis.call('SET', KEYS[1], ARGV[1]) end " +
    "redis.call('EXPIRE', KEYS[1], ARGV[2]) return 1";

async function flush() {
    if (!enabled) return;
    const counts = pending;
    const visitors = pendingVisitors;
    pending = new Map();
    pendingVisitors = new Map();
    const cmds = [];
    for (const [key, n] of counts) {
        const [d, event] = key.split('|');
        cmds.push(['INCRBY', `${P}:${d}:${event}`, String(n)], ['EXPIRE', `${P}:${d}:${event}`, String(DAY_TTL)]);
        cmds.push(['INCRBY', `${P}:total:${event}`, String(n)]);
    }
    for (const [d, set] of visitors) {
        cmds.push(['PFADD', `${P}:${d}:visitors`, ...set], ['EXPIRE', `${P}:${d}:visitors`, String(DAY_TTL)]);
    }
    const peak = { ...peakToday };
    if (peak.value > 0 && (peak.day !== peakWritten.day || peak.value > peakWritten.value)) {
        cmds.push(['EVAL', RAISE_SCRIPT, '1', `${P}:${peak.day}:peak`, String(peak.value), String(DAY_TTL)]);
        cmds.push(['EVAL', RAISE_SCRIPT, '1', `${P}:total:peak`, String(peak.value), '315360000']);
    }
    if (!cmds.length) return;
    try {
        await redis(cmds);
        if (peak.value > 0) peakWritten = peak;
    } catch (e) {
        // Put the counts back so the next flush retries them.
        for (const [key, n] of counts) pending.set(key, (pending.get(key) || 0) + n);
        for (const [d, set] of visitors) {
            if (!pendingVisitors.has(d)) pendingVisitors.set(d, new Set());
            set.forEach(h => pendingVisitors.get(d).add(h));
        }
        console.warn('Stats flush failed:', e.message);
    }
}

// Daily rows (newest first) + all-time totals, for the stats page.
async function report(days = 30) {
    if (!enabled) return { enabled: false };
    await flush(); // include what's still in memory
    const dates = Array.from({ length: days }, (_, i) => day(new Date(Date.now() - i * 86400000)));
    const fields = [...EVENTS, 'peak'];
    const cmds = [];
    for (const d of dates) {
        cmds.push(['MGET', ...fields.map(f => `${P}:${d}:${f}`)]);
        cmds.push(['PFCOUNT', `${P}:${d}:visitors`]);
    }
    cmds.push(['MGET', ...fields.map(f => `${P}:total:${f}`)]);
    const out = await redis(cmds);
    const num = v => Number(v) || 0;
    const rows = dates.map((d, i) => {
        const values = out[i * 2];
        const row = { day: d, visitors: num(out[i * 2 + 1]) };
        fields.forEach((f, j) => { row[f] = num(values[j]); });
        return row;
    });
    const totalVals = out[out.length - 1];
    const totals = {};
    fields.forEach((f, j) => { totals[f] = num(totalVals[j]); });
    return { enabled: true, rows, totals, generatedAt: new Date().toISOString() };
}

if (enabled) {
    setInterval(() => { flush(); }, FLUSH_MS).unref();
    const onExit = () => { flush().finally(() => process.exit(0)); };
    process.once('SIGTERM', onExit);
    process.once('SIGINT', onExit);
}

module.exports = { enabled, EVENTS, track, trackVisit, observeOnline, flush, report, redis };
