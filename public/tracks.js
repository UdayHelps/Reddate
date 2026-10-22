/* Per-viewer subtitles and audio-track switching for the direct-video player.
 *
 * Both are personal choices, so nothing here is synced to the room: each viewer
 * picks their own subtitle language / audio track.
 *
 * Subtitles come from Stremio subtitle addons (built-in OpenSubtitles v3 plus
 * any the room added, via window.reddateAddons) or a local .srt/.vtt file.
 * Addons serve SRT; browsers need WebVTT, so files are converted and attached
 * as a <track> from a blob: URL.
 *
 * Audio tracks: only Safari exposes HTMLMediaElement.audioTracks, and hls.js
 * handles HLS audio groups. Chrome/Firefox can't switch the audio of a plain
 * file, so the Audio button only appears where switching actually works.
 *
 * app.js calls tracks.attach(video) / attachHls(hls) / setContent(state) /
 * detach() as the player changes.
 */
window.tracks = (function () {
    const PREF_KEY = 'reddate-sub-lang';   // remembered subtitle language ('off' or code)
    const OFFSET_STEP = 0.5;

    let video = null;
    let hls = null;
    let content = null;        // { type, id, filename } of what's playing, if known
    let subs = null;           // fetched subtitle list for `content`
    let subsPromise = null;
    let activeSubUrl = null;   // url (or 'file:<name>') of the subtitle showing
    let activeLang = 'off';
    let activeLabel = '';      // what the 'Showing …' line says for a loaded file
    let trackEl = null;
    let blobUrl = null;
    let offset = 0;            // seconds added to every cue
    let browsingLang = null;   // language selected in the panel

    const $ = id => document.getElementById(id);
    const modal = () => $('trackModal');
    const body = () => $('trackModalBody');

    function toast(msg) { if (window.showToast) window.showToast(msg); }

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    // Each profile remembers its own subtitle language (the old device-wide choice is the starting point).
    const prefKey = () => { const a = window.reddateAccount; const id = a && a.activeProfileId ? a.activeProfileId() : null; return id ? `${PREF_KEY}:${id}` : PREF_KEY; };
    function getPref() { try { return localStorage.getItem(prefKey()) || localStorage.getItem(PREF_KEY) || 'off'; } catch (e) { return 'off'; } }
    function setPref(v) { try { localStorage.setItem(prefKey(), v); } catch (e) {} }

    // ---------- language names ----------
    // OpenSubtitles uses ISO 639-2 codes (eng, spa, pob…); map to BCP 47 for Intl.
    const LANG_MAP = {
        eng: 'en', spa: 'es', spn: 'es', ea: 'es-419', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it',
        por: 'pt', pob: 'pt-BR', pb: 'pt-BR', rus: 'ru', ara: 'ar', hin: 'hi', tur: 'tr', per: 'fa', fas: 'fa',
        ell: 'el', gre: 'el', cze: 'cs', ces: 'cs', pol: 'pl', dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no',
        dan: 'da', fin: 'fi', hun: 'hu', rum: 'ro', ron: 'ro', heb: 'he', jpn: 'ja', kor: 'ko', chi: 'zh',
        zho: 'zh', zht: 'zh-Hant', zhe: 'zh', ind: 'id', may: 'ms', msa: 'ms', tha: 'th', vie: 'vi',
        ukr: 'uk', bul: 'bg', hrv: 'hr', scc: 'sr', srp: 'sr', slv: 'sl', slo: 'sk', slk: 'sk', est: 'et',
        lav: 'lv', lit: 'lt', ben: 'bn', tam: 'ta', tel: 'te', mal: 'ml', urd: 'ur', kan: 'kn', mar: 'mr',
        ice: 'is', isl: 'is', bos: 'bs', mac: 'mk', mkd: 'mk', alb: 'sq', sqi: 'sq', geo: 'ka', kat: 'ka',
        arm: 'hy', hye: 'hy', cat: 'ca', baq: 'eu', eus: 'eu', glg: 'gl', tgl: 'tl', fil: 'fil', pan: 'pa',
        guj: 'gu', sin: 'si', khm: 'km', mon: 'mn', aze: 'az', kaz: 'kk', uzb: 'uz', bel: 'be', afr: 'af',
        swa: 'sw', amh: 'am', som: 'so', nep: 'ne'
    };
    let displayNames = null;
    try { displayNames = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }); } catch (e) {}
    function langName(code) {
        const tag = LANG_MAP[code] || code;
        try { const n = displayNames && displayNames.of(tag); if (n && n !== tag) return n; } catch (e) {}
        return (code || '?').toUpperCase();
    }

    // ---------- SRT → WebVTT ----------
    function decodeText(buf) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
        catch (e) { return new TextDecoder('windows-1252').decode(buf); } // common for old .srt files
    }

    function toVtt(text) {
        text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
        if (/^WEBVTT/.test(text)) return text;
        const body = text
            // 0:05:57,000 → 00:05:57.000 (VTT needs '.' and two-digit hours)
            .replace(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g,
                (_, h, m, s, ms) => `${h.padStart(2, '0')}:${m}:${s}.${ms.padEnd(3, '0')}`)
            .replace(/\{\\[^}]*\}/g, '')         // ASS override tags like {\an8}
            .replace(/<\/?font[^>]*>/gi, '');    // <font> isn't valid in VTT
        return 'WEBVTT\n\n' + body;
    }

    // ---------- ranking ----------
    // Subtitles timed for a different release drift, so prefer ones whose name
    // shares words with the playing file and push early CAM/TS rips down.
    function words(s) { return new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1)); }
    function rankSubs(list) {
        const fileWords = words(content && content.filename);
        const score = s => {
            const n = s.name.toLowerCase();
            let sc = 0;
            words(n).forEach(w => { if (fileWords.has(w)) sc += 1; });
            if (/\b(cam|hdcam|ts|telesync|tc|telecine|scr|screener|r5|hdts)\b/.test(n)) sc -= 6;
            if (/blu-?ray|brrip|bdrip|web-?dl|webrip|\bweb\b|hdrip|dvdrip/.test(n)) sc += 2;
            return sc;
        };
        return list.map((s, i) => ({ s, sc: score(s), i })).sort((a, b) => b.sc - a.sc || a.i - b.i).map(x => x.s);
    }

    // ---------- applying subtitles ----------
    function clearSubtitle() {
        if (trackEl) { trackEl.remove(); trackEl = null; }
        if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
        activeSubUrl = null;
        activeLang = 'off';
        activeLabel = '';
        offset = 0;
    }

    function shiftCues() {
        const cues = trackEl && trackEl.track && trackEl.track.cues;
        if (!cues) return;
        for (const cue of cues) {
            if (cue._base === undefined) cue._base = [cue.startTime, cue.endTime];
            cue.startTime = Math.max(0, cue._base[0] + offset);
            cue.endTime = Math.max(0, cue._base[1] + offset);
        }
    }

    function attachVtt(vtt, key, lang, label) {
        if (!video) return;
        clearSubtitle();
        blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
        trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.label = label;
        trackEl.srclang = LANG_MAP[lang] || 'und';
        trackEl.src = blobUrl;
        trackEl.default = true;
        trackEl.addEventListener('load', shiftCues);
        video.appendChild(trackEl);
        trackEl.track.mode = 'showing';
        activeSubUrl = key;
        activeLang = lang;
        activeLabel = label;
    }

    async function applySubtitle(sub) {
        if (!video) return;
        setPanelStatus('Loading subtitle…');
        try {
            const res = await fetch(sub.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const vtt = toVtt(decodeText(await res.arrayBuffer()));
            attachVtt(vtt, sub.url, sub.lang, langName(sub.lang));
            setPref(sub.lang);
            setPanelStatus('');
        } catch (e) {
            setPanelStatus(`Couldn't load that subtitle (${e.message}). Try another one.`);
        }
        renderPanel();
    }

    function loadSubtitleFile(file) {
        if (!file || !video) return;
        if (file.size > 5 * 1024 * 1024) { toast('Subtitle file too large (max 5 MB)'); return; }
        const reader = new FileReader();
        reader.onload = () => {
            attachVtt(toVtt(decodeText(reader.result)), `file:${file.name}`, 'und', file.name);
            renderPanel();
        };
        reader.readAsArrayBuffer(file);
    }

    function ensureSubs() {
        if (subs) return Promise.resolve(subs);
        if (!content || !window.reddateAddons) return Promise.resolve([]);
        if (!subsPromise) {
            const forContent = content;
            subsPromise = window.reddateAddons.fetchSubtitles(content.type, content.id)
                .then(list => { if (forContent === content) subs = rankSubs(list); return subs || []; })
                .catch(() => { subsPromise = null; return []; });
        }
        return subsPromise;
    }

    // Turn subtitles on automatically in the language this viewer last picked.
    async function autoApplyPreferred() {
        const pref = getPref();
        if (pref === 'off' || !content) return;
        const forVideo = video;
        const list = await ensureSubs();
        if (forVideo !== video || activeSubUrl) return;
        const best = list.find(s => s.lang === pref);
        if (best) applySubtitle(best);
    }

    // ---------- audio tracks ----------
    function audioOptions() {
        if (hls && hls.audioTracks && hls.audioTracks.length) {
            return hls.audioTracks.map((t, i) => ({
                label: t.name || (t.lang ? langName(t.lang) : `Track ${i + 1}`),
                enabled: i === hls.audioTrack,
                select: () => { hls.audioTrack = i; }
            }));
        }
        const list = video && video.audioTracks;
        if (list && list.length) {
            const tracks = Array.from({ length: list.length }, (_, i) => list[i]);
            return tracks.map((t, i) => ({
                label: t.label || (t.language ? langName(t.language) : `Track ${i + 1}`),
                enabled: t.enabled,
                select: () => tracks.forEach(o => { o.enabled = o === t; })
            }));
        }
        return [];
    }

    // ---------- UI ----------
    function updateButtons() {
        $('subsBtn').style.display = video ? '' : 'none';
        $('subsBtn').classList.toggle('is-on', !!activeSubUrl);
        // Only offer audio switching where the browser can actually do it.
        $('audioBtn').style.display = video && audioOptions().length > 1 ? '' : 'none';
    }

    function setPanelStatus(text) { const s = $('trackStatus'); if (s) s.textContent = text || ''; }

    let panelMode = null; // 'subs' | 'audio'

    function openPanel(mode) {
        panelMode = mode;
        modal().classList.add('show');
        renderPanel();
        if (mode === 'subs' && !subs && content) {
            setPanelStatus('Finding subtitles…');
            ensureSubs().then(() => { setPanelStatus(''); renderPanel(); });
        }
    }

    function renderPanel() {
        updateButtons();
        if (!modal().classList.contains('show')) return;
        const b = body();
        const status = $('trackStatus') ? $('trackStatus').textContent : '';
        b.innerHTML = '';
        if (panelMode === 'audio') renderAudio(b); else renderSubs(b);
        const st = el('div', 'browse-status');
        st.id = 'trackStatus';
        st.textContent = status;
        b.appendChild(st);
    }

    function renderAudio(b) {
        b.appendChild(el('h2', null, 'Audio track'));
        b.appendChild(el('div', 'addon-help', 'Only changes what you hear — everyone picks their own.'));
        const list = el('div', 'stream-list');
        audioOptions().forEach(opt => {
            const row = el('button', `stream-row ${opt.enabled ? 'active' : ''}`, (opt.enabled ? '✔ ' : '') + opt.label);
            row.onclick = () => { opt.select(); setTimeout(renderPanel, 100); };
            list.appendChild(row);
        });
        b.appendChild(list);
    }

    function icon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `#i-${name}`);
        svg.appendChild(use);
        return svg;
    }

    function renderSubs(b) {
        b.appendChild(el('h2', null, 'Subtitles'));

        // What's showing right now.
        const now = el('div', `sub-now ${activeSubUrl ? 'on' : ''}`);
        now.appendChild(icon('captions'));
        now.appendChild(document.createTextNode(activeSubUrl ? 'Showing ' : 'Subtitles are off'));
        if (activeSubUrl) {
            const pick = (subs || []).find(s => s.url === activeSubUrl);
            now.appendChild(el('b', null, pick ? `${langName(pick.lang)} · ${pick.name || pick.addon}` : activeLabel));
        }
        b.appendChild(now);

        const langs = new Map();
        (subs || []).forEach(s => langs.set(s.lang, (langs.get(s.lang) || 0) + 1));
        const pref = getPref();
        if (!browsingLang) browsingLang = activeLang !== 'off' ? activeLang : (langs.has(pref) ? pref : (langs.has('eng') ? 'eng' : [...langs.keys()][0] || null));

        const bar = el('div', 'browse-bar');
        const off = el('button', `tab-btn ${activeSubUrl ? '' : 'active'}`, 'Off');
        off.onclick = () => { clearSubtitle(); setPref('off'); renderPanel(); };
        bar.appendChild(off);
        if (langs.size) {
            const sel = el('select', 'browse-select');
            sel.setAttribute('aria-label', 'Subtitle language');
            [...langs.entries()]
                .sort((a, b) => (a[0] === pref ? -1 : b[0] === pref ? 1 : langName(a[0]).localeCompare(langName(b[0]))))
                .forEach(([code, n]) => {
                    const o = el('option', null, `${langName(code)} (${n})`);
                    o.value = code;
                    sel.appendChild(o);
                });
            sel.value = browsingLang;
            sel.onchange = () => { browsingLang = sel.value; renderPanel(); };
            bar.appendChild(sel);
        }
        b.appendChild(bar);

        if (content && subs && !subs.length) b.appendChild(el('div', 'browse-status', 'No subtitles found for this title.'));
        if (!content) b.appendChild(el('div', 'browse-status', 'Online subtitles are available for movies & shows picked from 🍿 Browse. You can still load your own file.'));

        const list = el('div', 'stream-list sub-list');
        (subs || []).filter(s => s.lang === browsingLang).forEach((s, i) => {
            const active = s.url === activeSubUrl;
            const row = el('button', `stream-row ${active ? 'active' : ''}`);
            row.appendChild(el('div', 'stream-top', `${active ? '✔ ' : ''}${langName(s.lang)} #${i + 1} · ${s.addon}`));
            if (s.name) row.appendChild(el('div', 'stream-desc', s.name));
            row.onclick = () => applySubtitle(s);
            list.appendChild(row);
        });
        b.appendChild(list);

        if (activeSubUrl) {
            b.appendChild(el('div', 'sub-section', 'Timing'));
            const timing = el('div', 'sub-timing');
            const stepper = el('div', 'stepper');
            const minus = el('button', null, '−');
            const plus = el('button', null, '+');
            minus.setAttribute('aria-label', `Show subtitles ${OFFSET_STEP}s earlier`);
            plus.setAttribute('aria-label', `Show subtitles ${OFFSET_STEP}s later`);
            const val = el('span', 'sub-offset mono', `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`);
            val.setAttribute('aria-live', 'polite');
            minus.onclick = () => { offset -= OFFSET_STEP; shiftCues(); renderPanel(); };
            plus.onclick = () => { offset += OFFSET_STEP; shiftCues(); renderPanel(); };
            stepper.append(minus, val, plus);
            timing.append(stepper, el('span', 'addon-help', 'Subtitles too early? Press +. Too late? Press −.'));
            b.appendChild(timing);
        }

        const fileBtn = el('button', 'btn sub-file');
        fileBtn.append(icon('upload'), document.createTextNode('Use my own .srt / .vtt'));
        fileBtn.onclick = () => $('subFileInput').click();
        b.appendChild(fileBtn);
    }

    // ---------- wiring ----------
    function wire() {
        $('subsBtn').addEventListener('click', () => openPanel('subs'));
        $('audioBtn').addEventListener('click', () => openPanel('audio'));
        $('subFileInput').addEventListener('change', e => {
            loadSubtitleFile(e.target.files[0]);
            e.target.value = '';
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

    return {
        // For the TV app's own player: the online subtitles for `c`, best match first, with names.
        async listFor(c) {
            if (!c || !window.reddateAddons) return [];
            const keep = content;
            content = c; // rankSubs matches against the playing file's name
            try {
                const list = rankSubs(await window.reddateAddons.fetchSubtitles(c.type, c.id));
                return list.filter(s => /^https?:\/\//.test(s.url)).slice(0, 120).map(s => ({ url: s.url, lang: s.lang, label: langName(s.lang), name: s.name || '', addon: s.addon || '' }));
            } catch (e) { return []; } finally { content = keep; }
        },
        getPref,
        setPref,
        // A new <video> was created for a direct stream.
        attach(v) {
            video = v;
            hls = null;
            trackEl = null;
            blobUrl = null;
            activeSubUrl = null;
            activeLang = 'off';
            activeLabel = '';
            offset = 0;
            browsingLang = null;
            content = null;      // setContent() follows for every new player
            subs = null;
            subsPromise = null;
            if (v.audioTracks && v.audioTracks.addEventListener) {
                ['addtrack', 'removetrack', 'change'].forEach(ev => v.audioTracks.addEventListener(ev, renderPanel));
            }
            v.addEventListener('loadedmetadata', updateButtons);
            updateButtons();
        },
        attachHls(h) {
            hls = h;
            if (window.Hls) {
                h.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, renderPanel);
                h.on(window.Hls.Events.AUDIO_TRACK_SWITCHED, renderPanel);
            }
            updateButtons();
        },
        // What's playing (from the room's video state); null for pasted links.
        setContent(c) {
            const next = c && c.id ? c : null;
            if (next && content && next.id === content.id && next.filename === content.filename) return;
            content = next;
            subs = null;
            subsPromise = null;
            browsingLang = null;
            autoApplyPreferred();
        },
        detach() {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            video = null;
            hls = null;
            trackEl = null;
            blobUrl = null;
            activeSubUrl = null;
            content = null;
            subs = null;
            subsPromise = null;
            updateButtons();
            if (modal()) modal().classList.remove('show');
        }
    };
})();
