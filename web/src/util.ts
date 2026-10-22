import type { Json } from './engine';

export const https = (u: any): string => (typeof u === 'string' && u.startsWith('http://') ? 'https://' + u.slice(7) : typeof u === 'string' && u.startsWith('https://') ? u : '');
export const clock = (s: number): string => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};

export interface Meta {
    id: string; type: string; name: string; poster: string; background: string; description: string;
    releaseInfo: string; rating: string; genres: string[]; runtime: string; cast: string[]; imdbId: string;
    episodes: Episode[]; similar: Meta[]; _raw?: Json;
}
export interface Episode { id: string; title: string; season: number; number: number; thumbnail: string; overview: string }

export function parseMeta(o: Json, fallbackType = 'movie'): Meta {
    const type = o.type || fallbackType;
    const eps: Episode[] = Array.isArray(o.videos) ? o.videos.map((v: Json) => ({
        id: String(v.id || ''), title: v.title || v.name || 'Episode', season: Number(v.season) || 0, number: Number(v.episode) || 0,
        thumbnail: https(v.thumbnail), overview: v.overview || v.description || ''
    })).filter((e: Episode) => e.id) : [];
    eps.sort((a, b) => a.season - b.season || a.number - b.number);
    return {
        id: String(o.id || ''), type, name: o.name || 'Untitled',
        poster: https(o.poster) || https(o.background) || https(o.logo), background: https(o.background),
        description: o.description || '', releaseInfo: String(o.releaseInfo || o.year || ''), rating: String(o.imdbRating || ''),
        genres: Array.isArray(o.genres) ? o.genres : [], runtime: String(o.runtime || ''),
        cast: Array.isArray(o.cast) ? o.cast.slice(0, 8) : [], imdbId: String(o.imdb_id || ''),
        episodes: eps, similar: Array.isArray(o.similar) ? o.similar.map((x: Json) => parseMeta(x, type)).filter((m: Meta) => m.poster) : [],
        _raw: o
    };
}

export interface Stream {
    url: string; addon: string; name: string; title: string; quality: string; filename: string; logo: string;
    bitrate: number; match: number; matchWhy: string; matchExact: boolean;
}
export const parseStream = (o: Json): Stream => ({
    url: String(o.url || ''), addon: String(o.addon || ''), name: String(o.name || ''), title: String(o.title || ''),
    quality: String(o.quality || ''), filename: String(o.filename || ''), logo: https(o.logo), bitrate: Number(o.bitrate) || 0,
    match: Number(o.match) || 0, matchWhy: String(o.matchWhy || ''), matchExact: !!o.matchExact
});

const text = (s: Stream) => `${s.name} ${s.title} ${s.filename} ${s.quality}`.toLowerCase();
export function tierOf(s: Stream): string {
    const t = text(s);
    if (/\b(2160p?|4k|uhd)\b/.test(t)) return '4K';
    if (/\b1080p?\b|\bfhd\b|full ?hd/.test(t)) return '1080p';
    if (/\b720p?\b|\bhd\b/.test(t)) return '720p';
    if (/\b(480p?|360p?|sd|dvd(rip)?|cam|ts)\b/.test(t)) return 'SD';
    return 'Other';
}
export const TIER_ORDER = ['4K', '1080p', '720p', 'SD', 'Other'];
export const isHdr = (s: Stream) => /\b(hdr10\+?|hdr|dolby ?vision|dv)\b/i.test(text(s));
export function sizeGb(s: Stream): number {
    const m = /(\d+(?:\.\d+)?)\s*(gb|gib|mb|mib)\b/i.exec(`${s.title} ${s.name} ${s.filename}`);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    return /g/i.test(m[2]) ? n : n / 1024;
}
/** Will a browser play this? A guess from the file's name: containers and codecs browsers usually can't do. */
export function browserFit(s: Stream): { ok: boolean; why: string } {
    const t = text(s);
    if (/\bmkv\b|\.mkv\b/.test(t)) return { ok: false, why: 'MKV file' };
    if (/\b(hevc|x265|h\.?265|av1)\b/.test(t)) return { ok: false, why: 'HEVC video' };
    if (/\b(dts|truehd|atmos|eac3|ddp|dd\+?5\.1|ac3)\b/.test(t)) return { ok: false, why: 'Surround audio' };
    return { ok: true, why: '' };
}
export function qualityScore(s: Stream): number {
    const tier = ({ '4K': 5, '1080p': 4, '720p': 3, 'SD': 1, 'Other': 2 } as Record<string, number>)[tierOf(s)];
    return tier * 1000 + Math.min(sizeGb(s), 40) * 10 + (isHdr(s) ? 5 : 0) + (browserFit(s).ok ? 600 : 0);
}
