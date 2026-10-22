/* Stream badges: resolution, streaming service, HDR, source, audio, codec and
 * edition, detected from a stream's release name / description.
 *
 * Logos come only from Wikimedia Commons (public-domain logo files, which
 * Wikimedia allows linking to directly); everything else is a Reddate-styled
 * text badge. Logos sit on a white chip so dark logos stay visible in both
 * themes, and fall back to a text badge if an image fails to load.
 */
window.ReddateBadges = (function () {
    const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
    const MAX_BADGES = 9;

    // Order here is display order. `unless` hides a badge when a more specific one matched.
    const DEFS = [
        // resolution
        { id: '4k', label: '4K', cls: 'res', re: /\b(4k|2160p|uhd)\b/ },
        { id: '1080p', label: '1080p', cls: 'res', re: /\b1080[pi]\b/ },
        { id: '720p', label: '720p', cls: 'res', re: /\b720p\b/ },
        { id: '480p', label: '480p', cls: 'res', re: /\b(480p|576p)\b/ },
        { id: '360p', label: '360p', cls: 'res', re: /\b(360p|240p)\b/ },
        // streaming service the release came from
        { id: 'netflix', label: 'Netflix', logo: '0/08/Netflix_2015_logo.svg/120px-Netflix_2015_logo.svg.png', re: /\b(nf|nflx|netflix)\b/ },
        { id: 'prime', label: 'Prime Video', logo: '1/11/Amazon_Prime_Video_logo.svg/120px-Amazon_Prime_Video_logo.svg.png', re: /\b(amzn|amazon)\b/ },
        { id: 'appletv', label: 'Apple TV+', logo: '2/28/Apple_TV_Plus_Logo.svg/120px-Apple_TV_Plus_Logo.svg.png', re: /\b(atvp|apple[ ._-]?tv)/ },
        { id: 'disney', label: 'Disney+', logo: '3/3e/Disney%2B_logo.svg/120px-Disney%2B_logo.svg.png', re: /\b(dsnp|disney\+)/ },
        { id: 'max', label: 'Max', logo: 'c/ce/Max_logo.svg/120px-Max_logo.svg.png', re: /\b(hmax|hbo[ ._-]?max)\b|\bmax[ ._-]web/ },
        { id: 'hulu', label: 'Hulu', logo: 'f/f9/Hulu_logo_%282018%29.svg/120px-Hulu_logo_%282018%29.svg.png', re: /\bhulu\b/ },
        { id: 'peacock', label: 'Peacock', logo: 'f/fb/NBCUniversal_Peacock_Logo_%282020%E2%80%932026%29.svg/120px-NBCUniversal_Peacock_Logo_%282020%E2%80%932026%29.svg.png', re: /\b(pcok|peacock)\b/ },
        { id: 'paramount', label: 'Paramount+', logo: 'a/a5/Paramount_Plus.svg/120px-Paramount_Plus.svg.png', re: /\b(pmtp|paramount\+)/ },
        // picture
        { id: 'dv', label: 'Dolby Vision', logo: '3/3f/Dolby_Vision_%28logo%29.svg/120px-Dolby_Vision_%28logo%29.svg.png', re: /\b(dv|dovi|dolby[ ._-]?vision)\b/ },
        { id: 'hdr10p', label: 'HDR10+', cls: 'hdr', re: /hdr10(\+|plus)/ },
        { id: 'hdr10', label: 'HDR10', cls: 'hdr', re: /\bhdr10(?![+p\d])/ },
        { id: 'hdr', label: 'HDR', cls: 'hdr', re: /\b(hdr|hlg)\b/, unless: ['hdr10p', 'hdr10'] },
        { id: 'imax', label: 'IMAX', logo: '2/22/IMAX.svg/120px-IMAX.svg.png', re: /\bimax\b/ },
        // source
        { id: 'remux', label: 'REMUX', cls: 'src', re: /\bremux\b/ },
        { id: 'bluray', label: 'Blu-ray', logo: '1/14/Blu-ray_Disc.svg/120px-Blu-ray_Disc.svg.png', re: /\b(blu[ ._-]?ray|bdrip|brrip|bdremux)\b/ },
        { id: 'webdl', label: 'WEB-DL', cls: 'src', re: /\bweb[ ._-]?dl\b/ },
        { id: 'webrip', label: 'WEBRip', cls: 'src', re: /\bweb[ ._-]?rip\b/ },
        { id: 'hdtv', label: 'HDTV', cls: 'src', re: /\bhdtv\b/ },
        { id: 'cam', label: 'CAM', cls: 'warn', re: /\b(cam|camrip|hdcam|telesync|hdts|ts|telecine|tc)\b/ },
        // audio
        { id: 'atmos', label: 'Dolby Atmos', logo: 'a/a8/Dolby_Atmos_%28logo%29.svg/120px-Dolby_Atmos_%28logo%29.svg.png', re: /\batmos\b/ },
        { id: 'truehd', label: 'TrueHD', cls: 'aud', re: /\btrue[ ._-]?hd\b/ },
        { id: 'dtshd', label: 'DTS-HD MA', cls: 'aud', re: /\bdts[ ._-]?hd/ },
        { id: 'dtsx', label: 'DTS:X', cls: 'aud', re: /\bdts[ .:_-]?x\b/ },
        { id: 'dts', label: 'DTS', logo: '3/3d/DTS_logo.svg/120px-DTS_logo.svg.png', re: /\bdts\b/, unless: ['dtshd', 'dtsx'] },
        { id: 'ddp', label: 'DD+', cls: 'aud', re: /\b(ddp|e-?ac-?3)|\bdd\+|dolby[ ._]?digital[ ._]?plus/ },
        { id: 'dd', label: 'DD', cls: 'aud', re: /\bac-?3\b|\bdd(?=[ .]?[257]\.[01])|\bdd\b(?!\+)|dolby[ ._]?digital/, unless: ['ddp'] },
        { id: 'aac', label: 'AAC', cls: 'aud', re: /\baac/ },
        { id: 'flac', label: 'FLAC', cls: 'aud', re: /\bflac\b/ },
        { id: 'opus', label: 'Opus', cls: 'aud', re: /\bopus\b/ },
        // Dots separate words in release names ("FLAC.7.1.x264"); only reject version-like "1.7.1.2".
        { id: 'ch71', label: '7.1', cls: 'ch', re: /(?<!\d)(?<!\d\.)7\.1(?!\d)(?!\.\d)/ },
        { id: 'ch51', label: '5.1', cls: 'ch', re: /(?<!\d)(?<!\d\.)5\.1(?!\d)(?!\.\d)/, unless: ['ch71'] },
        { id: 'ch20', label: '2.0', cls: 'ch', re: /(?<!\d)(?<!\d\.)2\.0(?!\d)(?!\.\d)/, unless: ['ch71', 'ch51'] },
        // codec
        { id: 'hevc', label: 'HEVC', cls: 'codec', re: /\b(x265|h[ .]?265|hevc)\b/ },
        { id: 'h264', label: 'H.264', cls: 'codec', re: /\b(x264|h[ .]?264|avc)\b/ },
        { id: 'av1', label: 'AV1', logo: '8/84/AV1_logo_2018.svg/120px-AV1_logo_2018.svg.png', re: /\bav1\b/ },
        { id: '10bit', label: '10-bit', cls: 'codec', re: /\b10[ ._-]?bit\b|\bhi10p\b/ },
        // edition
        { id: 'criterion', label: 'Criterion', cls: 'ed', re: /\bcriterion\b/ }, // its logo is unreadable at badge size
        { id: 'extended', label: 'Extended', cls: 'ed', re: /\bextended\b/ },
        { id: 'dircut', label: 'Director\'s Cut', cls: 'ed', re: /director'?s[ ._-]?cut/ },
        { id: 'remaster', label: 'Remastered', cls: 'ed', re: /\bremaster(ed)?\b/ },
        { id: 'uncut', label: 'Uncut', cls: 'ed', re: /\buncut\b/ }
    ];

    function detect(text) {
        const t = String(text || '').toLowerCase();
        const hit = new Set(DEFS.filter(d => d.re.test(t)).map(d => d.id));
        return DEFS.filter(d => hit.has(d.id) && !(d.unless || []).some(u => hit.has(u)));
    }

    function textBadge(def) {
        const b = document.createElement('span');
        b.className = `badge badge-${def.cls || 'codec'}`;
        b.textContent = def.label;
        return b;
    }

    function logoBadge(def) {
        const b = document.createElement('span');
        b.className = 'badge badge-logo';
        b.title = def.label;
        const img = document.createElement('img');
        img.src = COMMONS + def.logo;
        img.alt = def.label;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => b.replaceWith(textBadge(def));
        b.appendChild(img);
        return b;
    }

    // A row of badges for a stream's text. CAM/TS warnings always make the cut.
    function render(text) {
        let defs = detect(text);
        if (defs.length > MAX_BADGES) {
            const cam = defs.find(d => d.id === 'cam');
            defs = defs.slice(0, MAX_BADGES);
            if (cam && !defs.includes(cam)) defs[MAX_BADGES - 1] = cam;
        }
        const row = document.createElement('span');
        row.className = 'badges';
        defs.forEach(d => row.appendChild(d.logo ? logoBadge(d) : textBadge(d)));
        return row;
    }

    return { detect, render };
})();
