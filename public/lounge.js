// Lounge extras (loaded only on /lounge): reactions, replies, one pinned message, seen, an invite card, people and host tools,
// and message alerts. Runs after app.js and uses its globals (socket, party, roomUsers, roomId, showToast).
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const store = {
        get: (k, d) => { try { const v = localStorage.getItem('lounge.' + k); return v === null ? d : v; } catch (_) { return d; } },
        set: (k, v) => { try { localStorage.setItem('lounge.' + k, v); } catch (_) {} }
    };
    const ICON = {
        invite: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
        people: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
        bellOff: '<path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.9 17.9 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><path d="M1 1l22 22"/>'
    };
    const svg = (k, size) => `<svg class="icon" width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
    const EMOJI = ['👍', '❤️', '😂', '😮', '🔥', '🎉'];
    const box = () => $('chatMessages');
    const lastText = div => { const c = div.querySelector('.message-content'); return c && c.querySelector('img') ? 'a photo' : ((c && c.textContent) || '').slice(0, 120); };

    // ---------- Replying ----------
    let replyTo = null;
    window.loungeReply = { take() { const r = replyTo; setReply(null); return r; } };
    function setReply(r) {
        replyTo = r;
        let bar = $('replyBar');
        if (!r) { if (bar) bar.remove(); return; }
        if (!bar) {
            bar = document.createElement('div'); bar.id = 'replyBar'; bar.className = 'reply-bar';
            const c = document.querySelector('.chat-input-container'); c.parentNode.insertBefore(bar, c);
        }
        bar.innerHTML = '<span></span><button type="button" aria-label="Cancel reply">✕</button>';
        bar.firstChild.textContent = `Replying to ${r.name}: ${r.text}`;
        bar.lastChild.onclick = () => setReply(null);
        $('messageInput').focus();
    }

    // ---------- Messages: actions, reactions ----------
    const reacts = new Map(); // mid -> Map(emoji -> Set(socket id))
    function drawReacts(mid) {
        const div = box().querySelector(`.message[data-mid="${CSS.escape(mid)}"]`);
        if (!div) return;
        let row = div.querySelector('.reacts');
        const m = reacts.get(mid);
        if (!m || !m.size) { if (row) row.remove(); return; }
        if (!row) { row = document.createElement('div'); row.className = 'reacts'; div.appendChild(row); }
        row.innerHTML = '';
        m.forEach((ids, e) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'react-chip' + (ids.has(socket.id) ? ' mine' : '');
            b.textContent = `${e} ${ids.size}`;
            b.onclick = ev => { ev.stopPropagation(); socket.emit('lounge', { k: 'react', mid, e }); };
            row.appendChild(b);
        });
    }
    function toggleActions(div) {
        const open = div.querySelector('.msg-actions');
        box().querySelectorAll('.msg-actions').forEach(a => a.remove());
        if (open || !div.dataset.mid) return;
        const bar = document.createElement('div'); bar.className = 'msg-actions';
        EMOJI.forEach(e => {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.setAttribute('aria-label', `React ${e}`);
            b.onclick = ev => { ev.stopPropagation(); socket.emit('lounge', { k: 'react', mid: div.dataset.mid, e }); bar.remove(); };
            bar.appendChild(b);
        });
        const act = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'txt'; b.textContent = label; b.onclick = ev => { ev.stopPropagation(); fn(); bar.remove(); }; bar.appendChild(b); };
        const name = (div.querySelector('.username') || {}).textContent || '';
        act('Reply', () => setReply({ mid: div.dataset.mid, name, text: lastText(div) }));
        act('Pin', () => socket.emit('lounge', { k: 'pin', mid: div.dataset.mid, name, text: lastText(div), img: !!div.querySelector('.message-content img') }));
        div.appendChild(bar);
    }

    // ---------- Pinned message ----------
    function drawPin(p) {
        let el = $('pinBar');
        if (!p) { if (el) el.remove(); return; }
        if (!el) { el = document.createElement('div'); el.id = 'pinBar'; el.className = 'pin-bar'; const h = document.querySelector('.chat-header'); h.after(el); }
        el.innerHTML = '<span class="pin-label">Pinned</span><div class="pin-text"><b></b><span></span></div><button type="button">Unpin</button>';
        el.querySelector('b').textContent = p.name;
        el.querySelector('.pin-text span').textContent = p.img ? ' a photo' : ' ' + p.text;
        el.querySelector('button').onclick = e => { e.stopPropagation(); socket.emit('lounge', { k: 'unpin' }); };
        el.querySelector('.pin-text').onclick = () => { const d = box().querySelector(`.message[data-mid="${CSS.escape(p.mid)}"]`); if (d) { d.scrollIntoView({ block: 'center', behavior: 'smooth' }); d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 1400); } };
    }

    // ---------- Seen ----------
    const seenAt = new Map(); // socket id -> { name, index of last message they have seen }
    let lastSeenSent = '';
    function msgs() { return [...box().querySelectorAll('.message[data-mid]')]; }
    function sendSeen() {
        if (document.hidden || !socket) return;
        const all = msgs(); const last = all[all.length - 1];
        if (!last || last.dataset.mid === lastSeenSent || last.classList.contains('self')) return;
        lastSeenSent = last.dataset.mid;
        socket.emit('lounge', { k: 'seen', mid: lastSeenSent });
    }
    function drawSeen() {
        box().querySelectorAll('.seen-label').forEach(e => e.remove());
        const all = msgs(); let idx = -1;
        all.forEach((d, i) => { if (d.classList.contains('self')) idx = i; });
        if (idx < 0) return;
        const names = [];
        seenAt.forEach(v => { if (v.index >= idx) names.push(v.name); });
        if (!names.length) return;
        const l = document.createElement('div'); l.className = 'seen-label';
        l.textContent = names.length > 2 ? `Seen by ${names.length}` : `Seen by ${names.join(', ')}`;
        all[idx].after(l);
    }

    // ---------- Message alerts ----------
    let alertsOn = store.get('notify', '1') === '1';
    let audioCtx = null, flashTimer = null; const baseTitle = document.title;
    function beep() {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.28);
            o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.3);
        } catch (_) {}
    }
    function alertNew(name) {
        if (!alertsOn) return;
        beep();
        if (document.hidden && !flashTimer) {
            let on = false;
            flashTimer = setInterval(() => { on = !on; document.title = on ? `● ${name} sent a message` : baseTitle; }, 1000);
        }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(flashTimer); flashTimer = null; document.title = baseTitle; sendSeen(); } });

    // ---------- Sheets: invite and people ----------
    function sheet(title, build) {
        let m = $('loungeSheet');
        if (!m) {
            m = document.createElement('div'); m.className = 'modal'; m.id = 'loungeSheet';
            m.innerHTML = '<div class="modal-content lounge-sheet"><button class="modal-close" aria-label="Close">✕</button><h2></h2><div class="sheet-body"></div></div>';
            m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('modal-close')) m.classList.remove('show'); });
            document.body.appendChild(m);
        }
        m.querySelector('h2').textContent = title;
        const body = m.querySelector('.sheet-body'); body.innerHTML = '';
        build(body); m.classList.add('show'); m.dataset.kind = title;
    }
    const inviteLink = () => `${location.origin}/lounge/${encodeURIComponent((typeof roomId !== 'undefined' && roomId) || location.pathname.split('/')[2] || '')}`;
    let qrLib = null;
    function loadQr() {
        if (window.qrcode) return Promise.resolve(window.qrcode);
        return qrLib || (qrLib = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; sc.onload = () => res(window.qrcode); sc.onerror = rej; document.head.appendChild(sc); }));
    }
    async function share() {
        const url = inviteLink();
        if (navigator.share) { try { await navigator.share({ title: 'Join me in the Reddate Lounge', text: 'Chat, talk and watch together:', url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
        try { await navigator.clipboard.writeText(url); showToast('Invite link copied'); } catch (_) { prompt('Copy this invite link:', url); }
    }
    function openInvite() {
        sheet('Invite friends', body => {
            const url = inviteLink();
            const qr = document.createElement('div'); qr.className = 'invite-qr'; body.appendChild(qr);
            loadQr().then(q => { const c = q(0, 'M'); c.addData(url); c.make(); qr.innerHTML = c.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }).catch(() => { qr.remove(); });
            const link = document.createElement('div'); link.className = 'invite-link'; link.textContent = url; body.appendChild(link);
            const row = document.createElement('div'); row.className = 'sheet-row';
            const copy = document.createElement('button'); copy.className = 'btn'; copy.textContent = 'Copy link';
            copy.onclick = async () => { try { await navigator.clipboard.writeText(url); showToast('Invite link copied'); } catch (_) { prompt('Copy this invite link:', url); } };
            const sh = document.createElement('button'); sh.className = 'btn btn-primary'; sh.textContent = 'Share'; sh.onclick = share;
            row.append(copy, sh); body.appendChild(row);
            const note = document.createElement('p'); note.className = 'sheet-note'; note.textContent = 'Joining the chat needs a free Reddate account, so friends will be asked to sign in first.'; body.appendChild(note);
        });
    }
    const isHost = () => !party || (party.hosts || []).includes(socket.id) || party.host === socket.id;
    let locked = false;
    function openPeople() {
        sheet('People', body => {
            const me = socket.id, host = isHost();
            (roomUsers || []).forEach(u => {
                const row = document.createElement('div'); row.className = 'person';
                const av = document.createElement('span'); av.className = 'avatar'; av.textContent = (u.name || '?').slice(0, 1).toUpperCase();
                const nm = document.createElement('span'); nm.className = 'pname';
                const isH = party && (u.ids || [u.id]).some(i => (party.hosts || []).includes(i) || party.host === i);
                nm.textContent = `${u.name || 'Guest'}${(u.ids || [u.id]).includes(me) ? ' (you)' : ''}${isH ? ' 👑' : ''}`;
                row.append(av, nm);
                if (host && !(u.ids || [u.id]).includes(me) && party) {
                    if (!isH) { const b = document.createElement('button'); b.className = 'btn btn-ghost'; b.textContent = 'Make host'; b.onclick = () => { socket.emit('set-host', { to: u.id, on: true }); setTimeout(openPeople, 300); }; row.appendChild(b); }
                    const k = document.createElement('button'); k.className = 'btn btn-ghost danger'; k.textContent = 'Remove'; k.onclick = () => { if (confirm(`Remove ${u.name || 'this person'} from the room?`)) { socket.emit('kick-user', { to: u.id }); setTimeout(openPeople, 300); } }; row.appendChild(k);
                }
                body.appendChild(row);
            });
            if (host) {
                const tools = document.createElement('div'); tools.className = 'sheet-row tools';
                const lk = document.createElement('button'); lk.className = 'btn'; lk.textContent = locked ? 'Unlock room' : 'Lock room';
                lk.onclick = () => { socket.emit('lounge', { k: 'lock', on: !locked }); $('loungeSheet').classList.remove('show'); };
                const mu = document.createElement('button'); mu.className = 'btn'; mu.textContent = 'Mute everyone';
                mu.onclick = () => { socket.emit('lounge', { k: 'mute-all' }); showToast('Everyone was muted'); };
                tools.append(lk, mu); body.appendChild(tools);
                const n = document.createElement('p'); n.className = 'sheet-note'; n.textContent = 'Only hosts see these tools. A locked room stops new people joining.'; body.appendChild(n);
            }
        });
    }

    // ---------- Top bar buttons ----------
    function addTopButtons() {
        const acts = document.querySelector('.top-actions');
        if (!acts || $('loungeInvite')) return;
        const mk = (id, label, html, fn) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'icon-btn'; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = html; b.onclick = fn; return b; };
        const bell = mk('loungeBell', '', '', () => { alertsOn = !alertsOn; store.set('notify', alertsOn ? '1' : '0'); drawBell(); showToast(alertsOn ? 'Message sounds on' : 'Message sounds off'); if (alertsOn) beep(); });
        function drawBell() { bell.innerHTML = svg(alertsOn ? 'bell' : 'bellOff'); bell.title = bell.ariaLabel = alertsOn ? 'Message sounds: on' : 'Message sounds: off'; bell.classList.toggle('muted', !alertsOn); }
        drawBell();
        const ppl = mk('loungePeople', 'People', svg('people') + '<span class="count" id="loungeCount"></span>', openPeople);
        const inv = mk('loungeInvite', 'Invite friends', svg('invite'), openInvite);
        acts.prepend(bell); acts.prepend(ppl); acts.prepend(inv);
    }
    function dropCardIfCrowded() { const c = $('inviteCard'); const n = parseInt(($('userCount') || {}).textContent, 10); if (c && (n > 1 || (roomUsers || []).length > 1)) c.remove(); }
    function drawCount() { const c = $('loungeCount'); if (c) c.textContent = (roomUsers || []).length || ''; }

    // ---------- Invite card in an empty chat ----------
    let cardShown = false;
    function inviteCard() {
        // Only when the room really is just you (the live count says so), and gone the moment anyone else is here.
        const n = parseInt(($('userCount') || {}).textContent, 10);
        if (cardShown || $('inviteCard') || msgs().length || !(n >= 0) || n > 1 || (roomUsers || []).length > 1) return;
        cardShown = true;
        const c = document.createElement('div'); c.id = 'inviteCard'; c.className = 'invite-card';
        c.innerHTML = '<b>You are the first one here</b><span>Bring your people in with a link or a QR code.</span><button class="btn btn-primary" type="button">Invite friends</button>';
        c.querySelector('button').onclick = openInvite;
        box().prepend(c);
    }

    // ---------- Emote bursts: tap a reaction and it floats up on everyone's screen ----------
    const BURST = ['👍', '❤️', '😂', '😮', '🔥', '🎉', '👏', '😢', '🤯', '🍿', '💀', '😍'];
    function burst(e, by) {
        for (let i = 0; i < 6; i++) setTimeout(() => {
            const el = document.createElement('div'); el.className = 'burst';
            el.textContent = e; el.style.left = (12 + Math.random() * 76) + 'vw'; el.style.setProperty('--dx', ((Math.random() - 0.5) * 60) + 'px');
            el.style.fontSize = (1.8 + Math.random() * 1.4) + 'rem'; el.style.animationDuration = (2 + Math.random()) + 's';
            if (i === 0 && by) el.dataset.by = by;
            document.body.appendChild(el); setTimeout(() => el.remove(), 3200);
        }, i * 90);
    }
    // The smiley opens a panel: every emoji (searchable, by category) goes into the message, or a quick reaction floats up for everyone.
    let pickerReady = null;
    function loadPicker() {
        return pickerReady || (pickerReady = import('/vendor/emoji/index.js'));
    }
    function togglePanel() {
        let t = $('emoteTray');
        if (t) { t.remove(); return; }
        t = document.createElement('div'); t.id = 'emoteTray'; t.className = 'emote-panel';
        t.innerHTML = '<div class="emote-tabs"><button type="button" data-tab="emoji" class="on">Emoji</button><button type="button" data-tab="react">Reactions</button></div><div class="emote-body"></div>';
        const body = t.querySelector('.emote-body');
        const show = tab => {
            t.querySelectorAll('.emote-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
            body.innerHTML = '';
            if (tab === 'react') {
                const tray = document.createElement('div'); tray.className = 'emote-tray';
                BURST.forEach(e => { const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.setAttribute('aria-label', `Send ${e}`); b.onclick = () => socket.emit('lounge', { k: 'burst', e }); tray.appendChild(b); });
                const hint = document.createElement('p'); hint.className = 'emote-hint'; hint.textContent = 'Floats up on everyone’s screen.';
                body.append(tray, hint);
                return;
            }
            const st = document.createElement('p'); st.className = 'emote-hint'; st.textContent = 'Loading emoji…'; body.appendChild(st);
            loadPicker().then(() => {
                const pk = document.createElement('emoji-picker');
                pk.classList.add('dark'); pk.dataSource = '/vendor/emoji/data.json'; pk.setAttribute('data-source', '/vendor/emoji/data.json');
                pk.addEventListener('emoji-click', ev => insertEmoji(ev.detail.unicode));
                body.innerHTML = ''; body.appendChild(pk);
            }).catch(() => { st.textContent = 'Couldn’t load the emoji list.'; });
        };
        t.querySelectorAll('.emote-tabs button').forEach(b => b.onclick = () => show(b.dataset.tab));
        const c = document.querySelector('.chat-input-container'); c.parentNode.insertBefore(t, c);
        show('emoji');
    }
    function insertEmoji(u) {
        const i = $('messageInput'); if (!i || !u) return;
        const a = i.selectionStart == null ? i.value.length : i.selectionStart, z = i.selectionEnd == null ? a : i.selectionEnd;
        i.value = i.value.slice(0, a) + u + i.value.slice(z);
        i.selectionStart = i.selectionEnd = a + u.length;
        i.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function addEmoteButton() {
        if ($('emoteBtn')) return;
        const gif = $('gifBtn'); if (!gif) return;
        const b = document.createElement('button'); b.type = 'button'; b.id = 'emoteBtn'; b.className = 'icon-btn emote-btn'; b.title = 'Emoji and reactions'; b.setAttribute('aria-label', 'Emoji and reactions'); b.textContent = '😊';
        b.onclick = () => togglePanel();
        gif.before(b);
    }

    // ---------- The room panel (computers): code, who is here, the two actions ----------
    function drawRoomPanel() {
        if (document.documentElement.classList.contains('frame')) return;
        const stage = document.querySelector('.stage'); if (!stage) return;
        let p = $('loungeRoom');
        if (!p) {
            p = document.createElement('section'); p.id = 'loungeRoom'; p.setAttribute('aria-label', 'Room');
            p.innerHTML = '<div class="lr-top"><p class="lr-label">You are in room</p><h2 class="lr-code"></h2><p class="lr-count"></p><ul class="lr-people"></ul>' +
                '<div class="lr-actions"><button type="button" class="main" id="lrCall">Join voice and video</button><button type="button" id="lrInvite">Invite friends</button></div></div>' +
                '<div class="lr-motif" aria-hidden="true"><i></i><i></i></div>';
            stage.prepend(p);
            $('lrCall').onclick = () => { const c = $('callBtn'); if (c) c.click(); };
            $('lrInvite').onclick = openInvite;
        }
        const code = (typeof prettyCode === 'function' && typeof roomId !== 'undefined' && roomId) ? prettyCode(roomId) : '';
        p.querySelector('.lr-code').textContent = code || '';
        const users = roomUsers || [];
        p.querySelector('.lr-count').textContent = users.length <= 1 ? 'Just you so far' : `${users.length} here`;
        const ul = p.querySelector('.lr-people'); ul.innerHTML = '';
        users.forEach(u => { const li = document.createElement('li'); const av = document.createElement('span'); av.className = 'av'; av.textContent = (u.name || '?').slice(0, 1).toUpperCase(); const nm = document.createElement('span'); nm.textContent = u.name + ((u.ids || [u.id]).includes(socket.id) ? ' (you)' : ''); li.append(av, nm); ul.appendChild(li); });
    }

    // ---------- Wiring ----------
    let bound = null;
    function bind() {
        if (typeof socket === 'undefined' || !socket || bound === socket) return;
        bound = socket;
        socket.on('lounge', d => {
            if (!d) return;
            if (d.k === 'react') {
                const m = reacts.get(d.mid) || new Map(); const s = m.get(d.e) || new Set();
                if (s.has(d.id)) s.delete(d.id); else s.add(d.id);
                if (s.size) m.set(d.e, s); else m.delete(d.e);
                reacts.set(d.mid, m); drawReacts(d.mid);
            } else if (d.k === 'seen') {
                const all = msgs(); const i = all.findIndex(x => x.dataset.mid === d.mid);
                if (i >= 0) { seenAt.set(d.id, { name: d.by, index: i }); drawSeen(); }
            } else if (d.k === 'burst') {
                burst(d.e, d.by);
            } else if (d.k === 'mute-all') {
                const mic = $('micBtn'); if (mic && !mic.classList.contains('off') && $('voicePanel') !== null) mic.click();
                showToast(`${d.by} muted everyone`);
            }
        });
        socket.on('lounge-pin', drawPin);
        socket.on('lounge-state', st => { locked = !!(st && st.locked); });
        socket.on('room-users', () => { drawCount(); dropCardIfCrowded(); drawRoomPanel(); });
        socket.on('user-count', dropCardIfCrowded);
        socket.on('party', () => {});
        socket.on('joined', () => { addTopButtons(); drawCount(); setTimeout(inviteCard, 300); });
        socket.on('kicked', () => {});
    }
    document.addEventListener('lounge:message', e => {
        const { div, kind, username } = e.detail;
        const ic = $('inviteCard'); if (ic) ic.remove();
        div.addEventListener('click', ev => { if (ev.target.closest('.msg-actions, .react-chip, .reply-quote')) return; toggleActions(div); });
        const q = div.querySelector('.reply-quote');
        if (q) q.onclick = ev => { ev.stopPropagation(); const t = box().querySelector(`.message[data-mid="${CSS.escape(q.dataset.mid)}"]`); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1400); } };
        if (kind !== 'self') {
            alertNew(username); sendSeen();
            // In the browser app's player: it shows the unread count and a pop-up while the chat panel is closed.
            if (document.documentElement.classList.contains('frame') && window.parent !== window) {
                try { window.parent.postMessage({ rd: 'lounge', ev: 'message', who: String(username || 'Someone').slice(0, 30), text: e.detail.msg && e.detail.msg.t === 'img' ? 'sent a photo' : String((e.detail.msg && e.detail.msg.v) || '').slice(0, 120) }, location.origin); } catch (_) {}
            }
        }
        drawSeen();
    });
    setInterval(() => { bind(); if ($('app') && !$('app').classList.contains('hidden')) { addTopButtons(); addEmoteButton(); inviteCard(); drawCount(); drawRoomPanel(); } }, 600);
    box() && box().addEventListener('scroll', sendSeen, { passive: true });
})();
