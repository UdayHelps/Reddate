/*
 * Two full-screen pages, shared by phone, desktop and TV:
 *   Addons  - switch addons on or off, add one, and choose which rows Home shows (and in what order)
 *   YouTube - paste a YouTube or video link and play it for the room
 * Both live in #managePage.
 */
window.reddatePages = (function () {
    const $ = id => document.getElementById(id);
    const A = () => window.reddateAddons;
    const H = () => window.reddateHome;
    const toast = m => { if (window.showToast) window.showToast(m); };

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function icon(name) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'icon');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(ns, 'use');
        use.setAttribute('href', `#i-${name}`);
        svg.appendChild(use);
        return svg;
    }
    function button(cls, label, onClick, ic) {
        const b = el('button', cls);
        b.type = 'button';
        if (ic) b.appendChild(icon(ic));
        if (label) b.appendChild(document.createTextNode(label));
        b.onclick = onClick;
        return b;
    }

    let current = null; // 'addons' | 'youtube'
    const isOpen = () => !$('managePage').hidden;

    function open(kind) {
        current = kind;
        $('managePage').hidden = false;
        document.documentElement.classList.add('mp-open');
        $('mpTitle').textContent = kind === 'youtube' ? 'YouTube' : 'Addons';
        if (kind === 'youtube') renderYouTube(); else renderAddons();
    }
    function close() {
        if (!isOpen()) return;
        $('managePage').hidden = true;
        document.documentElement.classList.remove('mp-open');
        clearTimeout(rebuildTimer);
        if (dirty && H()) { dirty = false; H().rebuild(); }
        current = null;
        document.dispatchEvent(new CustomEvent('reddate:page-closed'));
    }

    // ---------- Addons ----------
    let dirty = false, rebuildTimer = null;

    let addonsTab = 'addons'; // 'addons' | 'rows' | 'add'

    // The addon's picture, or a coloured letter when it has none (or it won't load).
    function badge(name, logo) {
        const hue = [...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
        const b = el('span', 'mp-badge');
        b.style.setProperty('--hue', hue);
        const letter = el('span', 'mp-badge-letter', (String(name).trim().charAt(0) || '?').toUpperCase());
        b.appendChild(letter);
        if (logo) {
            const im = document.createElement('img');
            im.alt = '';
            im.loading = 'lazy';
            im.referrerPolicy = 'no-referrer';
            im.onload = () => { letter.remove(); b.classList.add('has-img'); };
            im.onerror = () => im.remove();
            im.src = logo;
            b.appendChild(im);
        }
        return b;
    }

    function switchBtn(on, label, textOn, textOff, key, onToggle) {
        const sw = el('button', `mp-switch ${on ? 'is-on' : ''}`);
        sw.type = 'button';
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(on));
        sw.setAttribute('aria-label', label);
        sw.dataset.k = key;
        sw.appendChild(el('span', 'mp-switch-text', on ? textOn : textOff));
        sw.appendChild(el('span', 'mp-knob'));
        sw.onclick = onToggle;
        return sw;
    }

    // One addon as a card: name, what it does (chips), and its On/Off switch and Remove.
    function addonCard(a) {
        const card = el('div', `mp-card ${a.enabled ? '' : 'is-off'}`);
        const top = el('div', 'mp-card-top');
        top.appendChild(badge(a.name, a.logo));
        const names = el('div', 'mp-card-names');
        names.appendChild(el('div', 'mp-name', a.name));
        names.appendChild(el('div', 'mp-meta', a.host));
        top.appendChild(names);
        card.appendChild(top);
        const chips = el('div', 'mp-chips');
        if (a.catalog) chips.appendChild(el('span', 'mp-chip', a.rows ? `Catalog · ${a.rows} ${a.rows === 1 ? 'row' : 'rows'}` : 'Catalog'));
        if (a.stream) chips.appendChild(el('span', 'mp-chip', 'Streams'));
        if (a.subtitles) chips.appendChild(el('span', 'mp-chip', 'Subtitles'));
        if (a.builtIn) chips.appendChild(el('span', 'mp-chip is-soft', 'Built-in'));
        if (!a.loaded) chips.appendChild(el('span', 'mp-chip is-warn', 'Couldn’t load'));
        card.appendChild(chips);
        const foot = el('div', 'mp-card-foot');
        foot.appendChild(switchBtn(a.enabled, `${a.name} on or off`, 'On', 'Off', `sw:${a.url}`,
            () => { A().manage.setEnabled(a.url, !a.enabled); renderAddons(); focusSame(`sw:${a.url}`); }));
        const rm = button('mp-btn', 'Remove', async () => { await A().manage.remove(a.url); renderAddons(); }, null);
        rm.setAttribute('aria-label', `Remove ${a.name}`);
        foot.appendChild(rm);
        card.appendChild(foot);
        return card;
    }

    function tabs(counts) {
        const bar = el('div', 'mp-tabs');
        bar.setAttribute('role', 'tablist');
        [['addons', `Your addons${counts.addons ? ` · ${counts.addons}` : ''}`], ['rows', `Home rows${counts.rows ? ` · ${counts.rows}` : ''}`], ['add', 'New addon']].forEach(([id, label]) => {
            const t = el('button', `mp-tab ${addonsTab === id ? 'is-on' : ''}`, label);
            t.type = 'button';
            t.setAttribute('role', 'tab');
            t.setAttribute('aria-selected', String(addonsTab === id));
            t.dataset.k = `tab:${id}`;
            const go = () => { if (addonsTab === id) return; addonsTab = id; $('mpBody').scrollTop = 0; renderAddons(); focusSame(`tab:${id}`); };
            t.onclick = go;
            // On a TV the remote only moves: landing on a tab opens it (no OK needed).
            if (document.documentElement.classList.contains('tv')) t.addEventListener('focus', () => setTimeout(() => { if (document.activeElement === t) go(); }, 140));
            bar.appendChild(t);
        });
        return bar;
    }

    // "New here?": the beginner guide to finding and adding addon links, in its own tab.
    function guideLink() {
        const a = el('a', 'mp-guide');
        a.href = '/addons-guide'; a.target = '_blank'; a.rel = 'noopener';
        a.appendChild(el('strong', null, 'New here?'));
        a.appendChild(document.createTextNode(' Where to find addon links →'));
        return a;
    }

    // Shown on the TV only: typing links with a remote is slow, so point to the phone.
    let qrLib = null;
    function loadQr() {
        if (window.qrcode) return Promise.resolve(window.qrcode);
        if (!qrLib) qrLib = new Promise((resolve, reject) => {
            const sc = document.createElement('script');
            sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
            sc.onload = () => resolve(window.qrcode);
            sc.onerror = reject;
            document.head.appendChild(sc);
        });
        return qrLib;
    }
    function tvNote() {
        const wrapEl = el('aside', 'mp-tvnote');
        const toggle = el('button', 'mp-tvnote-toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.appendChild(el('span', 'mp-tvnote-kicker', 'Did you know?'));
        toggle.appendChild(el('span', 'mp-tvnote-line', 'You can manage addons from your phone or computer'));
        toggle.appendChild(el('span', 'mp-tvnote-chev', '⌄'));
        const more = el('div', 'mp-tvnote-more');
        more.hidden = true;
        const text = el('div', 'mp-tvnote-text');
        text.appendChild(el('p', 'mp-tvnote-body', 'Typing links with a remote is slow. Scan the code, or open the address below, and sign in. Your TV picks up the changes.'));
        text.appendChild(el('p', 'mp-tvnote-url', `${location.host}/addons`));
        more.appendChild(text);
        const qr = el('div', 'mp-tvnote-qr');
        qr.setAttribute('role', 'img');
        qr.setAttribute('aria-label', 'QR code for ' + location.host + '/addons');
        more.appendChild(qr);
        let drawn = false;
        toggle.onclick = () => {
            const open = more.hidden;
            more.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
            wrapEl.classList.toggle('is-open', open);
            // The picture is drawn the first time it opens; the address works without it.
            if (open && !drawn) {
                drawn = true;
                loadQr().then(q => { const c = q(0, 'M'); c.addData(`${location.origin}/addons`); c.make(); qr.innerHTML = c.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }).catch(() => { qr.remove(); });
            }
        };
        wrapEl.append(toggle, more);
        return wrapEl;
    }

    function group(wrap, title, sub, items, empty, withGuide) {
        if (!items.length && !empty) return;
        wrap.appendChild(el('h2', 'mp-h', title));
        if (sub) wrap.appendChild(el('p', 'mp-sub', sub));
        if (withGuide) wrap.appendChild(guideLink());
        if (!items.length) { wrap.appendChild(el('p', 'mp-empty', empty)); return; }
        const grid = el('div', 'mp-grid');
        items.forEach(a => grid.appendChild(addonCard(a)));
        wrap.appendChild(grid);
    }

    function renderAddons() {
        const body = $('mpBody');
        const keep = body.scrollTop;
        body.innerHTML = '';
        const wrap = el('div', 'mp-col mp-wide');
        const all = A().manage.list();
        const rows = H() ? H().rowList() : [];
        wrap.appendChild(tabs({ addons: all.length, rows: rows.length }));

        if (addonsTab === 'addons') {
            if (document.documentElement.classList.contains('tv')) wrap.appendChild(tvNote());
            group(wrap, 'Catalogs', 'They decide what Home shows.', all.filter(a => a.catalog), 'No catalog: Home is empty until you add one (Add an addon).');
            group(wrap, 'Stream sources', 'Where videos come from when you press Play.', all.filter(a => a.stream), 'No stream source yet. Add one to play movies and shows.', true);
            group(wrap, 'Subtitles', null, all.filter(a => a.subtitles && !a.catalog && !a.stream), '');
            group(wrap, 'Other', null, all.filter(a => !a.catalog && !a.stream && !a.subtitles), '');
        }

        if (addonsTab === 'rows') {
            wrap.appendChild(el('p', 'mp-sub', 'Choose which rows Home shows and in what order. The first visible row sets the big banner.'));
            const grid = el('div', 'mp-grid mp-grid-rows');
            if (!rows.length) wrap.appendChild(el('p', 'mp-empty', 'Add a catalog addon to get rows.'));
            rows.forEach((r, i) => {
                const card = el('div', `mp-card mp-rowcard ${r.visible ? '' : 'is-off'}`);
                card.appendChild(el('div', 'mp-name', r.title));
                const ctl = el('div', 'mp-rowctl');
                ctl.appendChild(switchBtn(r.visible, `Show ${r.title}`, 'Shown', 'Hidden', `row:${r.key}`,
                    () => { const l = rows.map(x => ({ ...x })); l[i].visible = !l[i].visible; commitRows(l); focusSame(`row:${r.key}`); }));
                const up = button('mp-btn mp-icon', null, () => move(rows, i, -1, r.key), 'arrow-up');
                up.setAttribute('aria-label', `Move ${r.title} up`);
                up.disabled = i === 0;
                up.dataset.k = `up:${r.key}`;
                const down = button('mp-btn mp-icon', null, () => move(rows, i, 1, r.key), 'chevron-down');
                down.setAttribute('aria-label', `Move ${r.title} down`);
                down.disabled = i === rows.length - 1;
                down.dataset.k = `down:${r.key}`;
                ctl.append(up, down);
                card.appendChild(ctl);
                grid.appendChild(card);
            });
            wrap.appendChild(grid);
        }

        if (addonsTab === 'add') {
            wrap.appendChild(el('p', 'mp-sub', 'Paste a Stremio or Nuvio addon link (it ends in manifest.json). Reddate works out whether it adds rows to Home, streams to play, or subtitles.'));
            wrap.appendChild(guideLink());
            const add = el('form', 'mp-add');
            const input = el('input', 'browse-input');
            input.type = 'url';
            input.placeholder = 'https://…/manifest.json';
            input.setAttribute('aria-label', 'Addon link');
            input.autocomplete = 'off';
            input.autocapitalize = 'off';
            const go = el('button', 'btn btn-primary', 'Add');
            go.type = 'submit';
            add.append(input, go);
            const status = el('div', 'mp-status');
            status.setAttribute('role', 'status');
            add.onsubmit = async e => {
                e.preventDefault();
                if (!input.value.trim()) { input.focus(); return; }
                go.disabled = true;
                status.textContent = 'Checking the addon…';
                const r = await A().manage.add(input.value);
                go.disabled = false;
                status.textContent = r.message;
                if (r.ok) { input.value = ''; addonsTab = 'addons'; setTimeout(() => { renderAddons(); const st = $('mpBody').querySelector('.mp-wide'); if (st) st.prepend(Object.assign(el('div', 'mp-flash'), { textContent: r.message })); }, 700); }
            };
            wrap.append(add, status);
            // One-tap suggestions (removed built-ins, Stremio's public catalog).
            const sugg = el('div', 'mp-grid');
            A().manage.suggested().then(list => {
                if (!list.length) return;
                sugg.before(el('h2', 'mp-h', 'Suggested'));
                list.forEach(sa => {
                    const card = el('div', 'mp-card');
                    const top = el('div', 'mp-card-top');
                    const names = el('div', 'mp-card-names');
                    names.append(el('div', 'mp-name', sa.name), el('div', 'mp-meta', sa.description));
                    top.append(badge(sa.name, ''), names);
                    card.appendChild(top);
                    const foot = el('div', 'mp-card-foot');
                    const b = button('mp-btn', 'Add', async () => { b.disabled = true; await A().manage.restore(sa.url); addonsTab = 'addons'; renderAddons(); }, 'plus');
                    foot.appendChild(b);
                    card.appendChild(foot);
                    sugg.appendChild(card);
                });
            });
            wrap.appendChild(sugg);
        }

        body.appendChild(wrap);
        body.scrollTop = keep;
    }

    function commitRows(list) {
        H().setRows(list);
        dirty = false; // setRows rebuilt Home already
        renderAddons();
    }
    function move(rows, i, d, key) {
        const l = rows.map(x => ({ ...x }));
        const j = i + d;
        if (j < 0 || j >= l.length) return;
        [l[i], l[j]] = [l[j], l[i]];
        commitRows(l);
        focusSame(`${d < 0 ? 'up' : 'down'}:${key}`);
    }
    // After re-rendering, put the focus back on the same control (or its twin if it's now disabled).
    function focusSame(k) {
        const t = $('mpBody').querySelector(`[data-k="${CSS.escape(k)}"]`);
        if (t && !t.disabled) { t.focus({ preventScroll: true }); return; }
        const twin = $('mpBody').querySelector(`[data-k="${CSS.escape(k.startsWith('up:') ? 'down:' + k.slice(3) : k.startsWith('down:') ? 'up:' + k.slice(5) : k)}"]`);
        if (twin && !twin.disabled) twin.focus({ preventScroll: true });
    }

    // ---------- YouTube & links ----------
    const youtubeId = url => { const m = url.match(/(?:youtu\.be\/|[?&]v=|\/(?:shorts|embed|live)\/)([\w-]{11})/); return m ? m[1] : null; };

    // Start a video for the room: asks "alone or together" first when you aren't in one yet.
    function playVideo(payload, label) {
        const room = window.reddateRoom;
        const home = H();
        const send = () => socket.emit('load-video', payload);
        close();
        if (room && !room.isInRoom() && home) {
            home.askHowToWatch(label, ({ name, together }) => {
                room.enterRoom(name, null, () => { send(); if (together) home.showInvite(); }, { lazy: !together });
            });
            return;
        }
        send();
        if (room) room.showRoom();
        toast(`Loading “${label}” for everyone`);
    }

    function playLink(text) {
        const url = text.trim();
        const id = youtubeId(url);
        if (id) { playVideo({ kind: 'yt', videoId: id, url }, 'YouTube video'); return true; }
        if (/^https?:\/\/\S+\.(mp4|webm|ogg|ogv|m4v|mov|m3u8|mkv)(\?\S*)?$/i.test(url)) {
            playVideo({ kind: 'direct', src: url }, 'Video link');
            return true;
        }
        return false;
    }

    function renderYouTube() {
        const body = $('mpBody');
        body.innerHTML = '';
        const wrap = el('div', 'mp-col');
        wrap.appendChild(el('h2', 'mp-h', 'Play a link'));
        wrap.appendChild(el('p', 'mp-sub', 'Paste a YouTube link (youtube.com, youtu.be or Shorts), or a direct video link (.mp4, .webm, .m3u8). It plays for everyone in the room.'));
        const form = el('form', 'mp-add');
        const input = el('input', 'browse-input');
        input.type = 'url';
        input.placeholder = 'https://youtube.com/watch?v=…';
        input.setAttribute('aria-label', 'Video link');
        input.autocomplete = 'off';
        input.autocapitalize = 'off';
        const go = el('button', 'btn btn-primary', 'Play for everyone');
        go.type = 'submit';
        form.append(input, go);
        const status = el('div', 'mp-status');
        status.setAttribute('role', 'status');
        form.onsubmit = e => {
            e.preventDefault();
            if (!input.value.trim()) { input.focus(); return; }
            if (!playLink(input.value)) status.textContent = 'That doesn’t look like a YouTube link or a video file link.';
        };
        wrap.append(form, status);
        body.appendChild(wrap);
        input.focus();
    }

    function wire() {
        $('mpBack').onclick = close;
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); } }, true);
        // A signed-in/out change swaps which addons are yours.
        document.addEventListener('reddate:account', () => { if (isOpen() && current === 'addons') renderAddons(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

    return { open, close, isOpen, openAddons: tab => { if (tab === 'add' || tab === 'rows' || tab === 'addons') addonsTab = tab; open('addons'); }, openYouTube: () => open('youtube') };
})();
