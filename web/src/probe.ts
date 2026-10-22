import { useEffect, useState } from 'react';
import { engine, Json } from './engine';
import type { Stream } from './util';

// "Will this stream play in this browser?" — the same way reddate.xyz decides: the file's real codecs
// (read from its header) rule out what this browser can't decode, then a short muted test play confirms
// that both picture and sound actually come through. Results are kept for the session.

export type Verdict = 'checking' | 'ok' | 'no' | 'unknown';

const VIDEO: Record<string, string> = {
    'V_MPEG4/ISO/AVC': 'video/mp4; codecs="avc1.640028"',
    'V_MPEGH/ISO/HEVC': 'video/mp4; codecs="hvc1.1.6.L120.90"',
    'V_AV1': 'video/mp4; codecs="av01.0.08M.08"',
    'V_VP9': 'video/webm; codecs="vp9"',
    'V_VP8': 'video/webm; codecs="vp8"',
    'V_MPEG4/ISO/ASP': 'video/mp4; codecs="mp4v.20.9"'
};
const AUDIO: Record<string, string> = {
    'A_AAC': 'audio/mp4; codecs="mp4a.40.2"',
    'A_EAC3': 'audio/mp4; codecs="ec-3"',
    'A_AC3': 'audio/mp4; codecs="ac-3"',
    'A_DTS': 'audio/mp4; codecs="dtsc"',
    'A_TRUEHD': 'audio/mp4; codecs="mlpa"',
    'A_OPUS': 'audio/webm; codecs="opus"',
    'A_VORBIS': 'audio/webm; codecs="vorbis"',
    'A_FLAC': 'audio/flac',
    'A_MPEG/L3': 'audio/mpeg'
};
const canCache = new Map<string, boolean>();
function can(type: string) {
    if (!canCache.has(type)) canCache.set(type, document.createElement('video').canPlayType(type) !== '');
    return canCache.get(type)!;
}
const codecOf = (map: Record<string, string>, id: string) => { const k = Object.keys(map).find(x => String(id || '').startsWith(x)); return k ? map[k] : null; };
const isHls = (u: string) => /\.m3u8($|\?)/i.test(u);
const text = (s: Stream) => `${s.name} ${s.title} ${s.filename}`.toLowerCase();

/** False when this browser certainly can't play it (no need to download anything to test). */
function mightPlay(s: Stream, tracks: Json | null): { ok: boolean; why: string } {
    const path = (s.url || '').toLowerCase().split('?')[0];
    const t = text(s);
    if (/\.(avi|wmv|flv|rmvb?|3gp)$/.test(path) || /\.(avi|wmv|flv|rmvb)\b/.test(t)) return { ok: false, why: 'AVI/WMV file' };
    const isMkv = !!tracks || path.endsWith('.mkv') || /\bmkv\b/.test(t);
    if (isMkv && !can('video/x-matroska') && !can('video/webm')) return { ok: false, why: 'MKV file' };
    if (tracks) {
        const v = (tracks.video || [])[0];
        const vt = v && codecOf(VIDEO, v.codec);
        if (vt && !can(vt)) return { ok: false, why: /HEVC/.test(v.codec) ? 'HEVC video' : 'Video codec' };
        const audio: Json[] = tracks.audio || [];
        const a = audio.find(x => x.isDefault) || audio[0];
        const at = a && codecOf(AUDIO, a.codec);
        if (at && !can(at)) return { ok: false, why: /DTS|TRUEHD|AC3|EAC3/.test(a.codec) ? 'Surround audio' : 'Audio codec' };
    } else {
        if (/\b(x265|h[ .]?265|hevc)\b/.test(t) && !can(VIDEO['V_MPEGH/ISO/HEVC'])) return { ok: false, why: 'HEVC video' };
        if (/\b(dts|truehd|atmos)\b/.test(t) && !can(AUDIO['A_DTS'])) return { ok: false, why: 'Surround audio' };
    }
    return { ok: true, why: '' };
}

let box: HTMLDivElement | null = null;
function probeBox() {
    if (!box) {
        box = document.createElement('div');
        box.setAttribute('aria-hidden', 'true');
        box.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;';
        document.body.appendChild(box);
    }
    return box;
}

/** A short muted play: true once both video and audio have been decoded. */
function testPlay(url: string, onAbort?: (abort: () => void) => void): Promise<boolean | null> {
    if (isHls(url)) return Promise.resolve(true); // hls.js plays these
    return new Promise(resolve => {
        const v = document.createElement('video');
        v.muted = true; v.defaultMuted = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.preload = 'auto';
        let done = false;
        const finish = (r: boolean | null) => {
            if (done) return; done = true;
            window.clearTimeout(t1); window.clearInterval(poll);
            v.pause(); v.removeAttribute('src'); v.load(); v.remove();
            resolve(r);
        };
        const decoded = () => {
            const x = v as any;
            if (!v.videoWidth) return false;
            if ('webkitVideoDecodedByteCount' in x && !x.webkitVideoDecodedByteCount) return false;
            if ('webkitAudioDecodedByteCount' in x) return x.webkitAudioDecodedByteCount > 0;
            return v.currentTime >= 1;
        };
        let t1 = window.setTimeout(() => finish(false), 25000);
        if (onAbort) onAbort(() => finish(false));
        v.onerror = () => finish(false);
        v.onloadedmetadata = () => {
            if (!v.videoWidth) return finish(false);
            window.clearTimeout(t1);
            t1 = window.setTimeout(() => finish(decoded()), 10000);
        };
        const poll = window.setInterval(() => { if (decoded()) finish(true); }, 250);
        v.src = url;
        probeBox().appendChild(v);
        const p = v.play();
        if (p && p.catch) p.catch(e => finish(e && e.name === 'NotAllowedError' ? null : false));
    });
}

const results = new Map<string, { v: Verdict; why: string }>();
const running = new Map<string, Promise<void>>();
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());
try { const saved = JSON.parse(sessionStorage.getItem('rd-probe') || '{}'); Object.entries(saved).forEach(([u, r]) => results.set(u, r as any)); } catch { /* fine */ }
const save = () => { try { sessionStorage.setItem('rd-probe', JSON.stringify(Object.fromEntries([...results].filter(([, r]) => r.v === 'ok' || r.v === 'no').slice(-300)))); } catch { /* fine */ } };

let active = 0;
const queue: (() => void)[] = [];
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const CONCURRENCY = IS_MOBILE ? 2 : 4;
const slot = () => new Promise<void>(r => { if (active < CONCURRENCY) { active++; r(); } else queue.push(() => { active++; r(); }); });
const release = () => { active--; const n = queue.shift(); if (n) n(); };

export function check(s: Stream): Promise<void> {
    if (!s.url) return Promise.resolve();
    // YouTube videos play in the YouTube player, on every device: nothing to test.
    if (/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/.test(s.url)) { if (results.get(s.url)?.v !== 'ok') { results.set(s.url, { v: 'ok', why: '' }); notify(); } return Promise.resolve(); }
    if (results.has(s.url) && results.get(s.url)!.v !== 'unknown') return Promise.resolve();
    if (running.has(s.url)) return running.get(s.url)!;
    const quick = mightPlay(s, null);
    if (!quick.ok) { results.set(s.url, { v: 'no', why: quick.why }); save(); notify(); return Promise.resolve(); }
    results.set(s.url, { v: 'checking', why: '' }); notify();
    const p = (async () => {
        // The file's header and the test play run together; the header can rule it out and cancel the test.
        const tracksP = engine.call<Json | null>('mediaTracks', { url: s.url }, 25000).catch(() => null);
        let ruled: { ok: boolean; why: string } | null = null;
        let abort: (() => void) | null = null;
        tracksP.then(t => { const g = mightPlay(s, t); if (!g.ok) { ruled = g; if (abort) abort(); } });
        await slot();
        try {
            if (ruled) { results.set(s.url, { v: 'no', why: (ruled as any).why }); return; }
            if (document.hidden) { results.set(s.url, { v: 'unknown', why: '' }); waiting.set(s.url, s); return; } // browsers won't play in a hidden tab
            const r = await testPlay(s.url, a => { abort = a; });
            if (ruled) results.set(s.url, { v: 'no', why: (ruled as any).why });
            else results.set(s.url, r === true ? { v: 'ok', why: '' } : r === false ? { v: 'no', why: 'Won’t play in this browser' } : { v: 'unknown', why: '' });
        } finally { release(); }
    })().catch(() => { results.set(s.url, { v: 'unknown', why: '' }); }).finally(() => { running.delete(s.url); save(); notify(); });
    running.set(s.url, p);
    return p;
}

/** Which stream to test first (same ordering as reddate.xyz): what this browser can play, sensible sizes, cached debrid. */
export function likelihood(s: Stream): number {
    const t = `${text(s)} ${(s.url || '').toLowerCase().split('?')[0]}`;
    const h264 = /\b(h\.?264|x264|avc)\b/.test(t);
    let n = 0;
    if (!can('video/x-matroska')) {
        if (/\bmp4\b/.test(t)) n += 4;
        if (/\bmkv\b/.test(t)) n -= 4;
    }
    if (/\b(ddp|dd\+|e-?ac-?3|ac-?3|atmos|dd5)/.test(t) && !can(AUDIO['A_EAC3'])) n -= 3;
    if (/\b(truehd|dts)/.test(t)) n -= 3;
    if (/\b(x265|h[ .]?265|hevc)\b/.test(t) && !can(VIDEO['V_MPEGH/ISO/HEVC'])) n -= 3;
    if (/10[ .-]?bit|hi10p/.test(t) && h264) n -= 3;
    if (/\bdv\b|dovi|dolby.?vision/.test(t)) n -= 1;
    if (/\baac\b/.test(t)) n += 1;
    if (h264) n += 1;
    const q = /2160p|\b4k\b|uhd/.test(t) ? '4k' : /1080p/.test(t) ? '1080' : /720p/.test(t) ? '720' : '';
    n += ({ '1080': 2, '720': 1, '4k': IS_MOBILE ? -3 : -1 } as Record<string, number>)[q] || 0;
    // Debrid: cached results (⚡, "[RD+]") play now; uncached ones first have to be downloaded by the service.
    const tag = `${s.name || ''} ${s.title || ''}`;
    if (/⚡|\[(?:rd|ad|tb|pm|dl|ed|oc|pk|pp)\+\]/i.test(tag)) n += 6;
    else if (/\[(?:rd|ad|tb|pm|dl|ed|oc|pk|pp)\b[^\]]*\]/i.test(tag)) n -= 6;
    return n;
}

/** Test streams best-bet first, a few at a time, until `want` are known to play or the time budget is spent. */
export async function checkMany(list: Stream[], want: number, cancelled: () => boolean, budgetMs = 45000): Promise<void> {
    let found = list.filter(s => results.get(s.url)?.v === 'ok').length;
    let i = 0;
    const until = Date.now() + budgetMs;
    const worker = async () => {
        while (!cancelled() && found < want && Date.now() < until) {
            const s = list[i++];
            if (!s) return;
            await check(s);
            if (results.get(s.url)?.v === 'ok') found++;
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// Streams that couldn't be tested while the tab was hidden: test them once it's back in view.
const waiting = new Map<string, Stream>();
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const list = [...waiting.values()]; waiting.clear();
    list.forEach(check);
});

export const verdict = (url: string) => results.get(url) || null;

/** Re-render when any check finishes. */
export function useVerdicts() {
    const [, set] = useState(0);
    useEffect(() => { const f = () => set(x => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
}
