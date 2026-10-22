// Accounts, saved profiles and device pairing.
//
// What the server stores per account: the email (for confirmation and reset
// mail), a salted hash of the password (never the password), the profiles with
// their addons and preferences, and a list of signed-in devices (hashed session
// tokens). The whole record is encrypted at rest with VAULT_SECRET, so a leaked
// database alone exposes nothing — but the server itself can read it, so this
// is not end-to-end encryption. Chat and rooms are separate: never stored.
//
// Needs persistent storage (Upstash, see stats.js), a mail provider
// (RESEND_API_KEY + MAIL_FROM) and VAULT_SECRET. Without them the feature is
// off. MAIL_MODE=log is for local development: mail is printed, data is kept
// in memory and a throwaway secret is used.

const crypto = require('crypto');
const { promisify } = require('util');
const stats = require('./stats');

const scrypt = promisify(crypto.scrypt);
const LOG_MODE = process.env.MAIL_MODE === 'log';
// Accounts go to Upstash when it's configured, except in local-development mode (MAIL_MODE=log):
// that keeps everything in memory, so testing never writes into the live database.
const PERSISTENT = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) && process.env.MAIL_MODE !== 'log';
const MAIL_READY = Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
const SECRET = process.env.VAULT_SECRET || (LOG_MODE ? 'dev-only-not-a-secret' : '');
const enabled = Boolean((PERSISTENT || LOG_MODE) && (MAIL_READY || LOG_MODE) && SECRET);

const DAY = 86400;
const SESSION_TTL = 90 * DAY;
const MAX_SESSIONS = 20;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200;
const MAX_PROFILES = 6;
const outbox = []; // log mode only: lets tests read the mail that would have been sent

// Two independent keys derived from the one secret.
const AT_REST_KEY = crypto.createHash('sha256').update(`reddate-at-rest:${SECRET}`).digest();
const PEPPER = crypto.createHash('sha256').update(`reddate-pepper:${SECRET}`).digest();

// ---------- encryption at rest ----------
function seal(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', AT_REST_KEY, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return `v1.${iv.toString('base64')}.${Buffer.concat([ct, c.getAuthTag()]).toString('base64')}`;
}
function unseal(text) {
    const [v, ivB64, bodyB64] = String(text).split('.');
    if (v !== 'v1') throw new Error('unknown record format');
    const body = Buffer.from(bodyB64, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', AT_REST_KEY, Buffer.from(ivB64, 'base64'));
    d.setAuthTag(body.subarray(body.length - 16));
    return JSON.parse(Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]).toString('utf8'));
}

// ---------- storage: Upstash in production, memory for local dev ----------
const mem = new Map();
// Local development only: DEV_STORE_FILE keeps the in-memory accounts across restarts (to test what a deploy does).
const DEV_FILE = LOG_MODE && process.env.DEV_STORE_FILE;
if (DEV_FILE) {
    try {
        const saved = JSON.parse(require('fs').readFileSync(DEV_FILE, 'utf8'));
        for (const [k, e] of Object.entries(saved)) mem.set(k, e.set ? { value: new Set(e.set), exp: 0 } : e);
    } catch (e) { /* nothing saved yet */ }
}
let devSaveT = null;
function devSave() {
    if (!DEV_FILE || devSaveT) return;
    devSaveT = setTimeout(() => {
        devSaveT = null;
        const out = {};
        for (const [k, e] of mem) out[k] = e.value instanceof Set ? { set: [...e.value] } : e;
        try { require('fs').writeFileSync(DEV_FILE, JSON.stringify(out)); } catch (e) { /* fine */ }
    }, 200);
}
const store = {
    async get(key) {
        if (PERSISTENT) return (await stats.redis([['GET', key]]))[0];
        const e = mem.get(key);
        if (!e) return null;
        if (e.exp && e.exp < Date.now()) { mem.delete(key); return null; }
        return e.value;
    },
    async set(key, value, ttlSec) {
        if (PERSISTENT) {
            await stats.redis([ttlSec ? ['SET', key, value, 'EX', String(ttlSec)] : ['SET', key, value]]);
        } else {
            mem.set(key, { value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
            devSave();
        }
    },
    async del(key) {
        if (PERSISTENT) await stats.redis([['DEL', key]]); else { mem.delete(key); devSave(); }
    },
    // A set of account ids, so the owner can list who signed up (the emails themselves stay inside each encrypted account).
    async sadd(key, member) {
        if (PERSISTENT) { await stats.redis([['SADD', key, member]]); return; }
        const e = mem.get(key) || { value: new Set() };
        e.value.add(member); mem.set(key, e); devSave();
    },
    async srem(key, member) {
        if (PERSISTENT) { await stats.redis([['SREM', key, member]]); return; }
        const e = mem.get(key); if (e) e.value.delete(member);
    },
    async smembers(key) {
        if (PERSISTENT) return (await stats.redis([['SMEMBERS', key]]))[0] || [];
        const e = mem.get(key); return e ? [...e.value] : [];
    }
};

// ---------- small helpers ----------
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const clip = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const validEmail = e => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const normEmail = e => e.trim().toLowerCase();
const validPassword = p => typeof p === 'string' && p.length >= MIN_PASSWORD && p.length <= MAX_PASSWORD;
const emailKey = email => `acct:e:${crypto.createHmac('sha256', PEPPER).update(normEmail(email)).digest('hex')}`;

const hits = new Map();
function allow(key, max, windowMs) {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.resetAt < now) { hits.set(key, { count: 1, resetAt: now + windowMs }); if (hits.size > 20000) hits.clear(); return true; }
    return ++h.count <= max;
}

async function hashPassword(password, saltHex) {
    return (await scrypt(password.normalize('NFKC'), Buffer.from(saltHex, 'hex'), 32)).toString('hex');
}
const DUMMY_SALT = '00'.repeat(16);

// ---------- the saved profiles ----------
const newVault = () => ({
    profiles: [{ id: 'p1', name: 'Me', main: true, follow: { addons: false, prefs: false }, addons: [], prefs: {} }],
    activeProfile: 'p1'
});

// Accepts only the expected shape and sizes; returns a cleaned copy or null.
function cleanVault(v) {
    if (!v || !Array.isArray(v.profiles) || v.profiles.length < 1 || v.profiles.length > MAX_PROFILES) return null;
    const ids = new Set();
    const profiles = [];
    for (const p of v.profiles) {
        if (!p || typeof p.id !== 'string' || !/^[\w-]{1,20}$/.test(p.id) || ids.has(p.id)) return null;
        ids.add(p.id);
        if (!Array.isArray(p.addons) || p.addons.length > 60) return null;
        if (!p.addons.every(u => typeof u === 'string' && u.length <= 2000 && /^https?:\/\//i.test(u))) return null;
        const prefs = p.prefs && typeof p.prefs === 'object' && !Array.isArray(p.prefs) ? p.prefs : {};
        if (JSON.stringify(prefs).length > 16000) return null; // hidden rows, remembered streams, continue watching
        profiles.push({
            id: p.id, name: clip(p.name, 24) || 'Profile', main: !!p.main,
            follow: { addons: !!(p.follow && p.follow.addons), prefs: !!(p.follow && p.follow.prefs) },
            addons: p.addons.slice(), prefs
        });
    }
    if (profiles.filter(p => p.main).length !== 1) return null; // exactly one main profile
    profiles.forEach(p => { if (p.main) p.follow = { addons: false, prefs: false }; });
    const active = ids.has(v.activeProfile) ? v.activeProfile : profiles.find(p => p.main).id;
    return { profiles, activeProfile: active };
}

// ---------- mail ----------
async function sendMail(to, subject, text) {
    if (LOG_MODE) {
        outbox.push({ to, subject, text });
        console.log(`\n[mail → ${to}] ${subject}\n${text}\n`);
        if (!MAIL_READY || process.env.MAIL_SEND_REAL !== '1') return; // local testing never emails anyone unless MAIL_SEND_REAL=1
    }
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
        let why = '';
        try { why = ' ' + String((await res.json()).message || '').slice(0, 160); } catch (e) { /* no body */ }
        throw new Error(`mail provider HTTP ${res.status}${why}`);
    }
}
const baseUrl = req => process.env.PUBLIC_URL || (LOG_MODE ? `${req.protocol}://${req.get('host')}` : 'https://reddate.xyz');

// ---------- accounts ----------
async function loadAcct(id) {
    const raw = await store.get(`acct:${id}`);
    return raw ? unseal(raw) : null;
}
// An account that never verifies its email expires after a day.
// An account nobody confirmed (and nobody used) for 30 days is dropped; confirmed ones are kept.
const UNVERIFIED_TTL = 30 * DAY;
const saveAcct = a => store.set(`acct:${a.id}`, seal(a), a.verified ? 0 : UNVERIFIED_TTL);
async function findByEmail(email) {
    const id = await store.get(emailKey(email));
    return id ? loadAcct(id) : null;
}

async function addSession(acct, hash, name, kind) {
    acct.sessions = (acct.sessions || []).filter(s => s.hash !== hash);
    acct.sessions.push({ hash, name: clip(name, 40) || 'Device', kind: kind === 'tv' ? 'tv' : 'web', createdAt: Date.now(), lastSeen: Date.now() });
    while (acct.sessions.length > MAX_SESSIONS) {
        const old = acct.sessions.shift();
        await store.del(`acct:s:${old.hash}`);
    }
    await store.set(`acct:s:${hash}`, acct.id, SESSION_TTL);
}
async function clearSessions(acct) {
    for (const s of acct.sessions || []) await store.del(`acct:s:${s.hash}`);
    acct.sessions = [];
}

function mount(app, express) {
    const prefixes = ['/api/auth', '/api/vault', '/api/device', '/api/devices', '/api/account'];
    app.use(prefixes, express.json({ limit: '100kb' }));

    // Cloudflare Turnstile on sign-up (bots), when its keys are set; off otherwise.
    const TURNSTILE_SITE = process.env.TURNSTILE_SITE_KEY || '';
    const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || '';
    app.get('/api/auth/config', (_req, res) => res.json({ enabled, turnstile: TURNSTILE_SITE && TURNSTILE_SECRET ? TURNSTILE_SITE : '', web: /^https:\/\/[a-z0-9.-]+$/i.test(process.env.WEB_PRIMARY || '') ? process.env.WEB_PRIMARY : '' }));
    async function humanCheck(req) {
        if (!TURNSTILE_SITE || !TURNSTILE_SECRET) return true;
        const t = req.body && req.body.captcha;
        if (typeof t !== 'string' || !t || t.length > 4096) return false;
        try {
            const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: t, remoteip: req.ip || '' }),
                signal: AbortSignal.timeout(8000)
            });
            const d = await r.json();
            return !!(d && d.success);
        } catch (e) {
            console.warn('turnstile:', e.message);
            return true; // Cloudflare unreachable: don't lock real people out (the per-IP limit still applies)
        }
    }

    // Everything below needs the feature on.
    app.use(prefixes, (_req, res, next) => enabled ? next() : res.status(503).json({ error: 'Accounts are not available on this server.' }));

    // Never let a storage hiccup crash the process or leak details.
    const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
        console.warn('accounts:', e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Try again.' });
    });

    async function requireAuth(req, res, next) {
        try {
            const [scheme, bearer] = (req.get('authorization') || '').split(' ');
            if (scheme !== 'Bearer' || !bearer || bearer.length > 100) return res.status(401).json({ error: 'Sign in again.' });
            const hash = sha256(bearer);
            const uid = await store.get(`acct:s:${hash}`);
            const acct = uid && await loadAcct(uid);
            const session = acct && (acct.sessions || []).find(s => s.hash === hash);
            if (!session) return res.status(401).json({ error: 'Sign in again.' });
            if (Date.now() - session.lastSeen > 3600 * 1000) { session.lastSeen = Date.now(); await saveAcct(acct); await store.set(`acct:s:${hash}`, uid, SESSION_TTL); }
            req.acct = acct; req.sessionHash = hash;
            next();
        } catch (e) { console.warn('accounts auth:', e.message); res.status(500).json({ error: 'Something went wrong. Try again.' }); }
    }

    app.post('/api/auth/register', wrap(async (req, res) => {
        if (!allow(`reg:${req.ip}`, 10, 3600000)) return res.status(429).json({ error: 'Too many sign-ups from here. Try again later.' });
        const b = req.body || {};
        if (!validEmail(b.email)) return res.status(400).json({ error: 'Enter a valid email.' });
        if (!validPassword(b.password)) return res.status(400).json({ error: `Use a password of at least ${MIN_PASSWORD} characters.` });
        if (!(await humanCheck(req))) return res.status(400).json({ error: 'Please complete the check, then try again.', code: 'captcha' });

        // An email that's taken stays taken, confirmed or not. Its real owner can always get in with
        // "Forgot password" (the reset link proves the inbox is theirs and signs everyone else out).
        if (await findByEmail(b.email)) {
            return res.status(409).json({ error: 'That email already has an account. Sign in instead, or use "Forgot password".', code: 'exists' });
        }
        const id = crypto.randomUUID();
        const authSalt = crypto.randomBytes(16).toString('hex');
        const acct = {
            id, email: normEmail(b.email), verified: false, createdAt: Date.now(),
            authSalt, authHash: await hashPassword(b.password, authSalt),
            vault: newVault(), vaultV: 1, sessions: []
        };
        // Signed in straight away; confirming the email can wait (it's what makes password resets safe).
        const session = token();
        await addSession(acct, sha256(session), (b.device && b.device.name) || 'Browser', 'web');
        await saveAcct(acct);
        await store.set(emailKey(acct.email), id, UNVERIFIED_TTL);
        store.sadd('acct:ids', id).catch(() => {}); // the owner's signup list
        // The account is made and signed in even if the email can't be sent right now ("send again" is in the menu).
        let mailed = true;
        try { await sendVerify(req, acct); } catch (e) { mailed = false; console.warn('accounts: confirm email not sent:', e.message); }
        res.json({ token: session, email: acct.email, verified: false, mailed, vault: acct.vault, v: acct.vaultV });
    }));

    async function sendVerify(req, acct) {
        const t = token();
        await store.set(`acct:t:${sha256(t)}`, JSON.stringify({ uid: acct.id, purpose: 'verify' }), 7 * DAY);
        await sendMail(acct.email, 'Confirm your Reddate email',
            `Welcome to Reddate!\n\nConfirm your email so you can always get back into your account:\n${baseUrl(req)}/?verify=${t}\n\n` +
            'The link works for 7 days. If you didn\'t sign up, ignore this email.');
    }

    app.post('/api/auth/resend', requireAuth, wrap(async (req, res) => {
        if (req.acct.verified) return res.json({ ok: true, verified: true });
        if (!allow(`resend:${req.acct.id}`, 3, 3600000)) return res.status(429).json({ error: 'We just sent one. Check your inbox (and spam).' });
        try { await sendVerify(req, req.acct); } catch (e) { console.warn('accounts: confirm email not sent:', e.message); return res.status(502).json({ error: 'Couldn’t send the email right now. Try again in a minute.' }); }
        res.json({ ok: true });
    }));

    app.post('/api/auth/verify', wrap(async (req, res) => {
        if (!allow(`verify:${req.ip}`, 30, 600000)) return res.status(429).json({ error: 'Slow down.' });
        const t = req.body && req.body.token;
        if (typeof t !== 'string' || t.length > 100) return res.status(400).json({ error: 'That link is invalid.' });
        const raw = await store.get(`acct:t:${sha256(t)}`);
        const info = raw && JSON.parse(raw);
        // Clicked twice (or opened on two devices): it worked the first time, so say so.
        if (info && info.purpose === 'used-verify') return res.json({ ok: true, already: true });
        const acct = info && info.purpose === 'verify' && await loadAcct(info.uid);
        if (!acct) return res.status(400).json({ error: 'That link has expired. Sign in and ask for a new one.' });
        acct.verified = true;
        await saveAcct(acct); // no expiry from here on
        await store.set(emailKey(acct.email), acct.id); // persist the email index too
        await store.set(`acct:t:${sha256(t)}`, JSON.stringify({ purpose: 'used-verify' }), DAY); // remembered for a day, can't be reused
        res.json({ ok: true });
    }));

    app.post('/api/auth/login', wrap(async (req, res) => {
        const b = req.body || {};
        if (!validEmail(b.email) || typeof b.password !== 'string' || !b.password || b.password.length > MAX_PASSWORD) {
            return res.status(400).json({ error: 'Enter your email and password.' });
        }
        if (!allow(`login-ip:${req.ip}`, 40, 900000) || !allow(`login:${normEmail(b.email)}`, 10, 900000)) {
            return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
        }
        const acct = await findByEmail(b.email);
        // Always do the same hashing work, so timing doesn't reveal which emails exist.
        const given = await hashPassword(b.password, acct ? acct.authSalt : DUMMY_SALT);
        const good = acct && crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(acct.authHash, 'hex'));
        if (!good) return res.status(401).json({ error: 'Wrong email or password.' });
        const t = token();
        await addSession(acct, sha256(t), (b.device && b.device.name) || 'Browser', 'web');
        await saveAcct(acct);
        res.json({ token: t, email: acct.email, verified: !!acct.verified, vault: acct.vault, v: acct.vaultV });
    }));

    app.post('/api/auth/logout', requireAuth, wrap(async (req, res) => {
        req.acct.sessions = req.acct.sessions.filter(s => s.hash !== req.sessionHash);
        await store.del(`acct:s:${req.sessionHash}`);
        await saveAcct(req.acct);
        res.json({ ok: true });
    }));

    // ----- saved profiles -----
    app.get('/api/vault', requireAuth, (req, res) => {
        res.set('Cache-Control', 'no-store').json({ vault: req.acct.vault, v: req.acct.vaultV, email: req.acct.email, verified: !!req.acct.verified });
    });
    // Optimistic concurrency: `base` must be the version you last saw.
    app.put('/api/vault', requireAuth, wrap(async (req, res) => {
        const b = req.body || {};
        if (!Number.isInteger(b.base)) return res.status(400).json({ error: 'Invalid request.' });
        if (!allow(`vault:${req.acct.id}`, 60, 60000)) return res.status(429).json({ error: 'Slow down.' });
        const clean = cleanVault(b.vault);
        if (!clean) return res.status(400).json({ error: 'Invalid profiles.' });
        if (b.base !== req.acct.vaultV) return res.status(409).json({ error: 'Changed elsewhere.', vault: req.acct.vault, v: req.acct.vaultV });
        req.acct.vault = clean;
        req.acct.vaultV = b.base + 1;
        await saveAcct(req.acct);
        res.json({ v: req.acct.vaultV });
        try { if (vaultListener) vaultListener(req.acct.id); } catch (e) { /* telling other devices is best effort */ }
    }));

    // Watch trackers (Trakt, WeTrakr, Simkl): connect with a code, report what plays.
    require('./trackers').mount(app, { requireAuth, saveAcct, wrap, express });

    // ----- forgot / reset -----
    app.post('/api/auth/forgot', wrap(async (req, res) => {
        const email = req.body && req.body.email;
        if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email.' });
        if (!allow(`forgot-ip:${req.ip}`, 5, 3600000) || !allow(`forgot:${normEmail(email)}`, 3, 3600000)) {
            return res.status(429).json({ error: 'Too many requests. Try again later.' });
        }
        const acct = await findByEmail(email);
        if (acct) {
            const t = token();
            await store.set(`acct:t:${sha256(t)}`, JSON.stringify({ uid: acct.id, purpose: 'reset' }), 3600);
            await sendMail(acct.email, 'Reset your Reddate password',
                `Choose a new password here (works for 1 hour):\n${baseUrl(req)}/?reset=${t}\n\n` +
                'Your saved profiles and addons are kept. If you didn\'t ask for this, ignore this email — your password is unchanged.');
        }
        res.status(202).json({ ok: true }); // same answer whether or not the email has an account
    }));

    app.post('/api/auth/reset', wrap(async (req, res) => {
        if (!allow(`reset:${req.ip}`, 10, 600000)) return res.status(429).json({ error: 'Slow down.' });
        const b = req.body || {};
        const raw = await store.get(`acct:t:${sha256(String(b.token || ''))}`);
        const info = raw && JSON.parse(raw);
        const acct = info && info.purpose === 'reset' && await loadAcct(info.uid);
        if (!acct) return res.status(400).json({ error: 'That link has expired. Ask for a new one.' });
        if (!validPassword(b.password)) return res.status(400).json({ error: `Use a password of at least ${MIN_PASSWORD} characters.` });
        acct.authSalt = crypto.randomBytes(16).toString('hex');
        acct.authHash = await hashPassword(b.password, acct.authSalt);
        acct.verified = true; // they proved they control the email
        await clearSessions(acct); // everyone is signed out
        await saveAcct(acct);
        await store.del(`acct:t:${sha256(b.token)}`);
        res.json({ ok: true });
    }));

    // ----- devices -----
    app.get('/api/devices', requireAuth, (req, res) => {
        res.json({
            devices: req.acct.sessions.map(s => ({
                id: s.hash.slice(0, 12), name: s.name, kind: s.kind, createdAt: s.createdAt, lastSeen: s.lastSeen,
                current: s.hash === req.sessionHash
            }))
        });
    });
    app.delete('/api/devices/:id', requireAuth, wrap(async (req, res) => {
        const s = req.acct.sessions.find(x => x.hash.slice(0, 12) === req.params.id);
        if (!s) return res.status(404).json({ error: 'Device not found.' });
        req.acct.sessions = req.acct.sessions.filter(x => x !== s);
        await store.del(`acct:s:${s.hash}`);
        await saveAcct(req.acct);
        res.json({ ok: true });
    }));

    // ----- adding a TV (device code flow) -----
    // The TV makes a random token and gives us only its hash, plus a name. It
    // shows a code. A signed-in phone enters the code and approves; that
    // registers the TV's token hash as a session on the account. The server
    // never holds a usable TV token.
    const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const newUserCode = () => Array.from(crypto.randomBytes(8), b => CODE_ALPHABET[b % 32]).join('');
    const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    app.post('/api/device/start', wrap(async (req, res) => {
        if (!allow(`dstart:${req.ip}`, 20, 600000)) return res.status(429).json({ error: 'Slow down.' });
        const b = req.body || {};
        if (!/^[a-f0-9]{64}$/.test(b.tokenHash || '')) return res.status(400).json({ error: 'Invalid request.' });
        const userCode = newUserCode();
        const deviceCode = token();
        await store.set(`acct:d:${userCode}`, JSON.stringify({ name: clip(b.name, 40) || 'TV', tokenHash: b.tokenHash, status: 'pending' }), 600);
        await store.set(`acct:dc:${sha256(deviceCode)}`, userCode, 600);
        res.json({ userCode: `${userCode.slice(0, 4)}-${userCode.slice(4)}`, deviceCode, expiresIn: 600, interval: 3 });
    }));

    app.get('/api/device/lookup', requireAuth, wrap(async (req, res) => {
        if (!allow(`dlook:${req.acct.id}`, 30, 600000)) return res.status(429).json({ error: 'Too many tries.' });
        const raw = await store.get(`acct:d:${cleanCode(req.query.code)}`);
        const d = raw && JSON.parse(raw);
        if (!d || d.status !== 'pending') return res.status(404).json({ error: 'That code isn\'t valid or has expired.' });
        res.json({ name: d.name });
    }));

    app.post('/api/device/approve', requireAuth, wrap(async (req, res) => {
        if (!allow(`dappr:${req.acct.id}`, 20, 600000)) return res.status(429).json({ error: 'Too many tries.' });
        const code = cleanCode(req.body && req.body.code);
        const raw = await store.get(`acct:d:${code}`);
        const d = raw && JSON.parse(raw);
        if (!d || d.status !== 'pending') return res.status(404).json({ error: 'That code isn\'t valid or has expired.' });
        await addSession(req.acct, d.tokenHash, d.name, 'tv');
        await saveAcct(req.acct);
        d.status = 'approved';
        await store.set(`acct:d:${code}`, JSON.stringify(d), 300);
        res.json({ ok: true, name: d.name });
    }));

    app.post('/api/device/poll', wrap(async (req, res) => {
        if (!allow(`dpoll:${req.ip}`, 120, 60000)) return res.status(429).json({ error: 'Slow down.' });
        const dc = req.body && req.body.deviceCode;
        if (typeof dc !== 'string' || dc.length > 100) return res.status(400).json({ error: 'Invalid request.' });
        const userCode = await store.get(`acct:dc:${sha256(dc)}`);
        const raw = userCode && await store.get(`acct:d:${userCode}`);
        const d = raw && JSON.parse(raw);
        if (!d) return res.status(410).json({ status: 'expired' });
        if (d.status !== 'approved') return res.json({ status: 'pending' });
        await store.del(`acct:d:${userCode}`);
        await store.del(`acct:dc:${sha256(dc)}`);
        res.json({ status: 'approved' }); // the TV now uses the token it made itself
    }));

    // ----- delete account -----
    app.post('/api/account/delete', requireAuth, wrap(async (req, res) => {
        const given = req.body && req.body.password;
        if (typeof given !== 'string' || !given || given.length > MAX_PASSWORD) return res.status(400).json({ error: 'Enter your password.' });
        if (!allow(`del:${req.acct.id}`, 5, 900000)) return res.status(429).json({ error: 'Too many tries.' });
        const h = await hashPassword(given, req.acct.authSalt);
        if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(req.acct.authHash, 'hex'))) return res.status(401).json({ error: 'Wrong password.' });
        await clearSessions(req.acct);
        await store.del(emailKey(req.acct.email));
        await store.del(`acct:${req.acct.id}`);
        store.srem('acct:ids', req.acct.id).catch(() => {}); // gone from the signup list too
        res.json({ ok: true });
    }));
}

// The owner's signup list: email, when, confirmed. Accounts that expired or were deleted drop out.
async function listSignups() {
    if (!enabled) return [];
    const ids = (await store.smembers('acct:ids')).slice(0, 5000);
    const out = [];
    for (const id of ids) {
        const a = await loadAcct(id).catch(() => null);
        if (!a) { store.srem('acct:ids', id).catch(() => {}); continue; }
        out.push({ email: a.email, createdAt: a.createdAt, verified: !!a.verified, profiles: (a.vault && a.vault.profiles || []).length, devices: (a.sessions || []).length });
    }
    return out.sort((x, y) => y.createdAt - x.createdAt);
}

// Who a session token belongs to (for "invite my devices"): { uid, device } or null.
async function sessionInfo(bearer) {
    if (!enabled || typeof bearer !== 'string' || !bearer || bearer.length > 100) return null;
    const hash = sha256(bearer);
    const uid = await store.get(`acct:s:${hash}`);
    const acct = uid && await loadAcct(uid);
    const session = acct && (acct.sessions || []).find(s => s.hash === hash);
    return session ? { uid: acct.id, device: session.name } : null;
}

// Called after someone saves their profiles/addons, so the server can tell that account's other devices.
let vaultListener = null;
function onVaultChange(fn) { vaultListener = fn; }

module.exports = { onVaultChange, enabled, mount, outbox, sessionInfo, listSignups, _internal: { seal, unseal, cleanVault } };
