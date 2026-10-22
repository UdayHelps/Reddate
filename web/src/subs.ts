export interface Cue { s: number; e: number; t: string }
const toSec = (h: string, m: string, s: string, ms: string) => (+h || 0) * 3600 + +m * 60 + +s + (+ms.padEnd(3, '0')) / 1000;
/** SRT or WebVTT text to cues. */
export function parseSubs(text: string): Cue[] {
    const out: Cue[] = [];
    const src = text.replace(/^﻿/, '').replace(/\r/g, '');
    const blocks = src.split(/\n{2,}/);
    const re = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
    for (const b of blocks) {
        const lines = b.split('\n');
        const i = lines.findIndex(l => re.test(l));
        if (i < 0) continue;
        const m = re.exec(lines[i])!;
        const t = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
        if (!t) continue;
        out.push({ s: toSec(m[1] || '0', m[2], m[3], m[4]), e: toSec(m[5] || '0', m[6], m[7], m[8]), t });
    }
    return out.sort((a, b) => a.s - b.s);
}
export function cueAt(cues: Cue[], t: number): string {
    // cues are sorted; a linear scan from a bisect is plenty fast for a film's worth
    let lo = 0, hi = cues.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (cues[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    const out: string[] = [];
    for (let i = idx; i >= 0 && i > idx - 4; i--) if (cues[i].e >= t) out.unshift(cues[i].t);
    return out.join('\n');
}
