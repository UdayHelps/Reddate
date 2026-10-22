/* Minimal Matroska (MKV/WebM) header reader: lists a file's tracks (codec,
 * plus language + default flag for audio) from its first few KB.
 *
 * Shared by the browser (window.ReddateMkv) and the server (require), so both
 * read headers the same way. Only walks EBML elements up to the Tracks list;
 * it never touches media data.
 */
(function (root) {
    const EBML_HEADER = 0x1A45DFA3;
    const SEGMENT = 0x18538067;
    const CLUSTER = 0x1F43B675;
    const TRACKS = 0x1654AE6B;
    const TRACK_ENTRY = 0xAE;
    const TRACK_TYPE = 0x83;        // 1 = video, 2 = audio
    const FLAG_DEFAULT = 0x88;
    const CODEC_ID = 0x86;          // e.g. "V_MPEGH/ISO/HEVC", "A_EAC3"
    const LANGUAGE = 0x22B59C;      // ISO 639-2, e.g. "hin"
    const LANGUAGE_BCP47 = 0x22B59D; // e.g. "hi"

    function readVint(buf, pos, keepMarker) {
        const first = buf[pos];
        if (first === undefined || first === 0) return null;
        let len = 1;
        while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
        if (len > 8 || pos + len > buf.length) return null;
        let value = keepMarker ? first : first & (0xFF >> len);
        let allOnes = value === (0xFF >> len);
        for (let i = 1; i < len; i++) {
            value = value * 256 + buf[pos + i];
            if (buf[pos + i] !== 0xFF) allOnes = false;
        }
        return { value, len, unknown: !keepMarker && allOnes };
    }

    function readElement(buf, pos) {
        const id = readVint(buf, pos, true);
        if (!id) return null;
        const size = readVint(buf, pos + id.len, false);
        if (!size) return null;
        const start = pos + id.len + size.len;
        return { id: id.value, start, end: size.unknown ? Infinity : start + size.value };
    }

    const readUint = (buf, s, e) => { let v = 0; for (let i = s; i < e; i++) v = v * 256 + buf[i]; return v; };
    const readStr = (buf, s, e) => new TextDecoder().decode(buf.subarray(s, e)).replace(/\0+$/, '');

    function parseTracks(buf, start, end) {
        const audio = [];
        const video = [];
        for (let pos = start; pos < end;) {
            const te = readElement(buf, pos);
            if (!te) break;
            if (te.id === TRACK_ENTRY) {
                const t = { type: 0, lang: '', bcp: '', def: 1, codec: '' };
                for (let p = te.start; p < te.end;) {
                    const c = readElement(buf, p);
                    if (!c || c.end > te.end) break;
                    if (c.id === TRACK_TYPE) t.type = readUint(buf, c.start, c.end);
                    else if (c.id === FLAG_DEFAULT) t.def = readUint(buf, c.start, c.end);
                    else if (c.id === LANGUAGE) t.lang = readStr(buf, c.start, c.end);
                    else if (c.id === LANGUAGE_BCP47) t.bcp = readStr(buf, c.start, c.end);
                    else if (c.id === CODEC_ID) t.codec = readStr(buf, c.start, c.end).slice(0, 32);
                    p = c.end;
                }
                // '' = no Language element: ambiguous in practice, so callers treat it as unknown.
                if (t.type === 2) audio.push({ lang: (t.bcp || t.lang).slice(0, 16), isDefault: !!t.def, codec: t.codec });
                else if (t.type === 1) video.push({ codec: t.codec, isDefault: !!t.def });
            }
            pos = te.end;
        }
        return audio.length || video.length ? { audio, video } : null;
    }

    // Tracks of an MKV from its first bytes, { audio, video }, or null (not MKV /
    // Tracks not in range).
    function parseMkvTracks(buf) {
        const ebml = readElement(buf, 0);
        if (!ebml || ebml.id !== EBML_HEADER) return null;
        const seg = readElement(buf, ebml.end);
        if (!seg || seg.id !== SEGMENT) return null;
        for (let pos = seg.start; pos < buf.length;) {
            const e = readElement(buf, pos);
            if (!e || e.end === Infinity || e.id === CLUSTER) return null;
            if (e.id === TRACKS) return e.end <= buf.length ? parseTracks(buf, e.start, e.end) : null;
            pos = e.end;
        }
        return null;
    }

    const api = { parseMkvTracks, HEADER_BYTES: 65536 };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ReddateMkv = api;
})(typeof window !== 'undefined' ? window : globalThis);
