/* Accounts in the browser: sign up / in, profiles, devices, adding a TV.
 *
 * The server keeps the account (email, password hash, saved profiles) encrypted
 * at rest. Each profile has addons and preferences; a non-main profile can
 * either follow the main profile's or keep its own.
 *
 * Off unless the server says accounts are enabled (/api/auth/config).
 */
window.reddateAccount = (function () {
    const $ = id => document.getElementById(id);
    const TOKEN_KEY = 'reddate-token';
    const PROFILE_KEY = 'reddate-profile';
    const MAX_PROFILES = 6;
    const MIN_PASSWORD = 10;

    let enabled = false;
    let token = null;
    let email = null;
    let vault = null;
    let vaultV = 0;
    let pendingLink = null;  // a TV code from a scanned QR, waiting for sign-in

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

    // ---------- server calls ----------
    async function api(path, { method = 'GET', body, auth = true } = {}) {
        // A request that never answers (a TV that just woke up, a dropped connection) must not hang for ever.
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : 0;
        try {
            const res = await fetch(path, {
                method,
                headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
                body: body ? JSON.stringify(body) : undefined,
                signal: ctrl ? ctrl.signal : undefined
            });
            const data = await res.json().catch(() => ({}));
            return { ok: res.ok, status: res.status, data };
        } catch (e) {
            return { ok: false, status: 0, data: { error: 'Couldn’t reach the server. Check your connection.' } };
        } finally { if (timer) clearTimeout(timer); }
    }

    // ---------- state ----------
    const profiles = () => (vault ? vault.profiles : []);
    const mainProfile = () => profiles().find(p => p.main) || profiles()[0];
    function activeProfile() {
        let id = null;
        try { id = localStorage.getItem(PROFILE_KEY); } catch (e) {}
        return profiles().find(p => p.id === id) || mainProfile();
    }
    const followsMain = (p, what) => !p.main && p.follow && p.follow[what];
    const settingsOwner = (p, what) => (p.main || followsMain(p, what) ? mainProfile() : p);
    const isSignedIn = () => Boolean(token && vault);

    function changed() {
        updateChrome();
        document.dispatchEvent(new CustomEvent('reddate:account'));
    }

    // Another device saved changes: take them (only if they're newer than what this one has).
    let turnstileKey = ''; // set from /api/auth/config when sign-up has a human check
    let refreshing = 0; // when the running refresh started (0 = none); a stuck one never blocks the next
    async function refresh() {
        if (!token) return;
        if (refreshing && Date.now() - refreshing < 25000) return;
        refreshing = Date.now();
        try {
            const r = await api('/api/vault');
            if (r.ok && r.data.v > vaultV) {
                vault = r.data.vault; vaultV = r.data.v;
                verified = r.data.verified !== false;
                changed();
                document.dispatchEvent(new CustomEvent('reddate:vault-updated'));
            }
        } finally { refreshing = 0; }
    }

    async function pushVault(reapply) {
        let tookTheirs = false;
        // Whatever happens, if we took another device's changes on the way, the rest of the app must hear about it:
        // this is how an addon added on the phone used to stay missing here until the app was restarted.
        const announce = () => { if (tookTheirs) { tookTheirs = false; document.dispatchEvent(new CustomEvent('reddate:vault-updated')); } };
        for (let attempt = 0; attempt < 3; attempt++) {
            const r = await api('/api/vault', { method: 'PUT', body: { vault, base: vaultV } });
            if (r.ok) { vaultV = r.data.v; announce(); return true; }
            if (r.status !== 409) { announce(); return false; }
            // Changed on another device: take theirs, re-apply this edit, try again.
            vault = r.data.vault;
            vaultV = r.data.v;
            tookTheirs = true;
            reapply(vault);
        }
        announce();
        return false;
    }
    // One save at a time: two quick changes (say, switching several addons off) must not overwrite each other.
    let pushQueue = Promise.resolve();
    async function mutate(fn) {
        fn(vault);
        changed();
        const run = () => pushVault(fn);
        const ok = await (pushQueue = pushQueue.then(run, run));
        if (!ok) toast('Couldn’t save that to your account. Try again.');
        changed();
        return ok;
    }

    let verified = true;
    function setSession(t, mail, v, ver, isVerified) {
        token = t; email = mail; vault = v; vaultV = ver; verified = isVerified !== false;
        try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
    }
    function clearSession() {
        token = email = vault = null;
        vaultV = 0;
        try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(PROFILE_KEY); } catch (e) {}
        changed();
    }

    async function restore() {
        try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }
        if (!token) return;
        const r = await api('/api/vault');
        if (r.status === 401) { clearSession(); return; }
        if (!r.ok) { token = null; return; } // offline: act signed out until we can check
        vault = r.data.vault;
        vaultV = r.data.v;
        email = r.data.email;
        verified = r.data.verified !== false;
    }

    // ---------- the addons the active profile uses ----------
    function getAddons() {
        if (!isSignedIn()) return [];
        return settingsOwner(activeProfile(), 'addons').addons.slice();
    }
    function addAddon(url) {
        if (!isSignedIn()) return Promise.resolve(false);
        const id = settingsOwner(activeProfile(), 'addons').id;
        return mutate(v => { const p = v.profiles.find(x => x.id === id); if (p && !p.addons.includes(url)) p.addons.push(url); });
    }
    // Small per-profile preferences (hidden rows, switched-off addons…). Follows the main profile when asked to.
    // What a person watched is theirs alone: Continue watching and remembered streams never come from another
    // profile, even when the profile uses the main one's addons and settings.
    // Everything else is the profile's own too (Home rows, order, autoplay…); only the addon switches go with
    // whoever's addons the profile uses, so "this addon is off" stays true for the list it belongs to.
    const ADDON_PREFS = new Set(['addonsOff', 'builtinsRemoved', 'off']);
    const prefOwner = key => (ADDON_PREFS.has(key) ? settingsOwner(activeProfile(), 'addons') : activeProfile());
    function getPref(key) {
        if (!isSignedIn()) return undefined;
        const p = prefOwner(key);
        return p.prefs ? p.prefs[key] : undefined;
    }
    function setPref(key, val) {
        if (!isSignedIn()) return false;
        const id = prefOwner(key).id;
        mutate(v => {
            const p = v.profiles.find(x => x.id === id);
            if (!p) return;
            p.prefs = p.prefs || {};
            if (val === undefined) delete p.prefs[key]; else p.prefs[key] = val;
        });
        return true;
    }
    function removeAddon(url) { removeAddons([url]); }
    // Several at once in one save, so quick removals can't overwrite each other.
    function removeAddons(urls) {
        if (!isSignedIn()) return;
        const drop = new Set(urls);
        const id = settingsOwner(activeProfile(), 'addons').id;
        mutate(v => { const p = v.profiles.find(x => x.id === id); if (p) p.addons = p.addons.filter(u => !drop.has(u)); });
    }

    // ---------- modal plumbing ----------
    let modal, body;
    function ensureModal() {
        if (modal) return;
        modal = $('accountModal');
        body = $('accountBody');
    }
    function show(view) {
        ensureModal();
        body.innerHTML = '';
        view(body);
        modal.classList.add('show');
        const first = body.querySelector('input:not([type=hidden]), button.btn-primary');
        if (first && matchMedia('(hover: hover)').matches) first.focus();
    }
    function close() { ensureModal(); modal.classList.remove('show'); }

    function field(label, type, name, extra = {}) {
        const wrap = el('label', 'acct-field');
        wrap.appendChild(el('span', 'field-label', label));
        const input = el('input', 'lobby-input');
        input.type = type; input.name = name;
        Object.entries(extra).forEach(([k, v]) => input.setAttribute(k, v));
        wrap.appendChild(input);
        return { wrap, input };
    }
    function form(onSubmit, ...children) {
        const f = el('form', 'acct-form');
        f.noValidate = true;
        children.forEach(c => c && f.appendChild(c));
        f.addEventListener('submit', e => { e.preventDefault(); onSubmit(); });
        return f;
    }
    function errorBox() { const e = el('div', 'acct-error'); e.setAttribute('role', 'alert'); return e; }
    function linkBtn(text, onClick) { const b = el('button', 'acct-link', text); b.type = 'button'; b.onclick = onClick; return b; }
    function primary(text) { const b = el('button', 'btn btn-primary', text); b.type = 'submit'; return b; }
    async function working(btn, text, fn) {
        const old = btn.textContent;
        btn.disabled = true; btn.textContent = text;
        try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
    }
    const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

    // ---------- views ----------
    function viewSignIn(note, prefillEmail) {
        show(b => {
            b.appendChild(el('h2', null, 'Sign in'));
            b.appendChild(el('p', 'acct-note', note || 'Save your profiles and addons, and use them on your phone, browser and TV.'));
            const e = field('Email', 'email', 'email', { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off' });
            const p = field('Password', 'password', 'password', { autocomplete: 'current-password' });
            if (prefillEmail) e.input.value = prefillEmail;
            const err = errorBox();
            const btn = primary('Sign in');
            b.appendChild(form(async () => {
                err.textContent = '';
                if (!validEmail(e.input.value.trim())) { err.textContent = 'Enter a valid email.'; return; }
                if (!p.input.value) { err.textContent = 'Enter your password.'; return; }
                await working(btn, 'Signing in…', async () => {
                    const msg = await signIn(e.input.value.trim(), p.input.value);
                    if (msg) err.textContent = msg;
                });
            }, e.wrap, p.wrap, err, btn));
            const row = el('div', 'acct-links');
            row.append(linkBtn('Create an account', viewSignUp), linkBtn('Forgot password?', () => viewForgot(e.input.value.trim())));
            b.appendChild(row);
        });
    }

    async function signIn(mail, password) {
        const r = await api('/api/auth/login', { method: 'POST', auth: false, body: { email: mail, password, device: { name: deviceName() } } });
        if (!r.ok) return r.data.error || 'Couldn’t sign in.';
        setSession(r.data.token, r.data.email, r.data.vault, r.data.v, r.data.verified);
        afterSignIn('Signed in');
        return '';
    }
    function afterSignIn(msg) {
        changed();
        toast(msg);
        if (pendingLink) viewDevices();
        else if (profiles().length > 1) viewWho();
        else close();
    }

    function deviceName() {
        const ua = navigator.userAgent;
        const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Device';
        const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
        return `${br} on ${os}`;
    }

    function viewSignUp() {
        show(b => {
            b.appendChild(el('h2', null, 'Create an account'));
            b.appendChild(el('p', 'acct-note', 'Save your profiles and addons so they follow you to every device. We store your email and keep your saved data encrypted at rest.'));
            const e = field('Email', 'email', 'email', { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off' });
            const p = field('Password', 'password', 'new-password', { autocomplete: 'new-password', minlength: String(MIN_PASSWORD) });
            b.appendChild(el('p', 'acct-hint', `At least ${MIN_PASSWORD} characters. A few random words works well.`));
            // A quick "are you human" check (Cloudflare Turnstile), only when the server has it switched on.
            const human = el('div', 'acct-captcha');
            let captcha = '';
            if (turnstileKey) {
                const draw = () => { try { window.turnstile.render(human, { sitekey: turnstileKey, theme: 'dark', callback: t => { captcha = t; }, 'expired-callback': () => { captcha = ''; } }); } catch (e) { /* fine */ } };
                if (window.turnstile) draw();
                else {
                    const sc = document.createElement('script');
                    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
                    sc.async = true; sc.onload = draw;
                    document.head.appendChild(sc);
                }
            }
            const legal = el('p', 'acct-hint');
            legal.append(document.createTextNode('By creating an account you agree to how we handle your data: '));
            const pl = el('a', null, 'Privacy'); pl.href = '/privacy'; pl.target = '_blank'; pl.rel = 'noopener';
            legal.append(pl, document.createTextNode('.'));
            const err = errorBox();
            const btn = primary('Create account');
            b.appendChild(form(async () => {
                err.textContent = '';
                const mail = e.input.value.trim();
                if (!validEmail(mail)) { err.textContent = 'Enter a valid email.'; return; }
                if (p.input.value.length < MIN_PASSWORD) { err.textContent = `Use at least ${MIN_PASSWORD} characters for your password.`; return; }
                await working(btn, 'Creating…', async () => {
                    if (turnstileKey && !captcha) { err.textContent = 'Please complete the check first.'; return; }
                    const r = await api('/api/auth/register', { method: 'POST', auth: false, body: { email: mail, password: p.input.value, device: { name: deviceName() }, captcha } });
                    if (!r.ok && r.data.code === 'captcha' && window.turnstile) { try { window.turnstile.reset(human); } catch (e) { /* fine */ } captcha = ''; }
                    if (!r.ok) {
                        err.textContent = r.data.error || 'Couldn’t create the account.';
                        if (r.data.code === 'exists') { err.textContent = ''; viewSignIn('That email already has an account. Sign in, or use “Forgot password?”.', mail); }
                        return;
                    }
                    setSession(r.data.token, r.data.email, r.data.vault, r.data.v, false);
                    afterSignIn('Account created. You’re signed in.');
                });
            }, e.wrap, p.wrap, human, legal, err, btn));
            b.appendChild(el('div', 'acct-links')).appendChild(linkBtn('I already have an account', () => viewSignIn()));
        });
    }

    function viewCheckEmail(mail, note) {
        show(b => {
            b.appendChild(el('h2', null, 'Check your email'));
            b.appendChild(el('p', 'acct-note', note || `We sent a link to ${mail}. Open it to confirm your email, then come back and sign in.`));
            b.appendChild(el('p', 'acct-hint', 'No email? Look in spam. The link works for 24 hours.'));
            b.appendChild(el('div', 'acct-links')).appendChild(linkBtn('Back to sign in', () => viewSignIn(null, mail)));
        });
    }

    function viewForgot(prefill) {
        show(b => {
            b.appendChild(el('h2', null, 'Forgot your password?'));
            b.appendChild(el('p', 'acct-note', 'We’ll email you a link to choose a new one. Your saved profiles and addons are kept.'));
            const e = field('Email', 'email', 'email', { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off' });
            if (prefill) e.input.value = prefill;
            const err = errorBox();
            const btn = primary('Send reset link');
            b.appendChild(form(async () => {
                err.textContent = '';
                const mail = e.input.value.trim();
                if (!validEmail(mail)) { err.textContent = 'Enter a valid email.'; return; }
                await working(btn, 'Sending…', async () => {
                    const r = await api('/api/auth/forgot', { method: 'POST', auth: false, body: { email: mail } });
                    if (!r.ok) { err.textContent = r.data.error || 'Couldn’t send that.'; return; }
                    viewCheckEmail(mail, `If ${mail} has an account, a reset link is on its way. It works for 1 hour.`);
                });
            }, e.wrap, err, btn));
            b.appendChild(el('div', 'acct-links')).appendChild(linkBtn('Back to sign in', () => viewSignIn()));
        });
    }

    function viewReset(resetToken) {
        show(b => {
            b.appendChild(el('h2', null, 'Choose a new password'));
            const p = field('New password', 'password', 'new-password', { autocomplete: 'new-password' });
            const c = field('Confirm new password', 'password', 'confirm', { autocomplete: 'new-password' });
            const err = errorBox();
            const btn = primary('Set new password');
            b.appendChild(form(async () => {
                err.textContent = '';
                if (p.input.value.length < MIN_PASSWORD) { err.textContent = `Use at least ${MIN_PASSWORD} characters.`; return; }
                if (p.input.value !== c.input.value) { err.textContent = 'The two passwords don’t match.'; return; }
                await working(btn, 'Saving…', async () => {
                    const r = await api('/api/auth/reset', { method: 'POST', auth: false, body: { token: resetToken, password: p.input.value } });
                    if (!r.ok) { err.textContent = r.data.error || 'Couldn’t reset the password.'; return; }
                    viewSignIn('Password updated. Sign in with your new password.');
                });
            }, p.wrap, c.wrap, err, btn));
        });
    }

    // Who's watching?
    function viewWho() {
        // The TV app has its own profile picker.
        const N = window.ReddateNative;
        if (N && N.hasNativeUi && N.hasNativeUi() && N.event) { close(); N.event(JSON.stringify({ type: 'pick-profile' })); return; }
        show(b => {
            b.appendChild(el('h2', null, 'Who’s watching?'));
            const grid = el('div', 'profile-grid');
            const cur = activeProfile();
            profiles().forEach(p => {
                const t = el('button', `profile-tile ${p.id === cur.id ? 'active' : ''}`);
                t.type = 'button';
                t.appendChild(el('span', 'avatar', (p.name || '?').trim().charAt(0).toUpperCase() || '?'));
                t.appendChild(el('span', 'profile-name', p.name));
                t.onclick = () => { setActive(p.id); close(); };
                grid.appendChild(t);
            });
            b.appendChild(grid);
            b.appendChild(el('div', 'acct-links')).appendChild(linkBtn('Manage profiles', viewManage));
        });
    }
    function setActive(id) {
        // Save the old profile's Continue watching first, so it can't end up in the new one's.
        try { if (window.reddateContinue) window.reddateContinue.flush(); } catch (e) { /* fine */ }
        try { localStorage.setItem(PROFILE_KEY, id); } catch (e) {}
        changed();
    }

    function viewManage() {
        show(b => {
            const back = el('button', 'back-btn'); back.type = 'button';
            back.append(icon('chevron-left'), document.createTextNode('Account'));
            back.onclick = viewMenu;
            b.appendChild(back);
            b.appendChild(el('h2', null, 'Profiles'));
            b.appendChild(el('p', 'acct-note', 'The main profile holds your default addons and preferences. Other profiles can follow it, or keep their own.'));
            profiles().forEach(p => {
                const card = el('div', 'profile-card');
                const head = el('div', 'profile-card-head');
                const av = el('span', 'avatar', (p.name || '?').trim().charAt(0).toUpperCase() || '?');
                head.appendChild(av);
                const name = el('input', 'lobby-input'); name.type = 'text'; name.value = p.name; name.maxLength = 24;
                name.setAttribute('aria-label', 'Profile name');
                name.onchange = () => {
                    const v = name.value.trim() || p.name;
                    name.value = v;
                    av.textContent = v.charAt(0).toUpperCase();
                    mutate(x => { x.profiles.find(q => q.id === p.id).name = v; });
                };
                head.appendChild(name);
                if (p.main) head.appendChild(el('span', 'badge', 'Main'));
                card.appendChild(head);
                if (!p.main) {
                    [['addons', 'Use the main profile’s addons'], ['prefs', 'Use the main profile’s preferences']].forEach(([key, label]) => {
                        const l = el('label', 'acct-check');
                        const box = el('input'); box.type = 'checkbox'; box.checked = !!(p.follow && p.follow[key]);
                        box.onchange = () => mutate(x => { const q = x.profiles.find(r => r.id === p.id); q.follow = { ...(q.follow || {}), [key]: box.checked }; });
                        l.append(box, el('span', null, label));
                        card.appendChild(l);
                    });
                    const rm = el('button', 'acct-link danger', 'Delete profile'); rm.type = 'button';
                    rm.onclick = async () => {
                        if (!confirm(`Delete the profile “${p.name}”? Its own addons and preferences will be removed.`)) return;
                        await mutate(x => { x.profiles = x.profiles.filter(q => q.id !== p.id); });
                        if (activeProfile().id === p.id) setActive(mainProfile().id);
                        viewManage();
                    };
                    card.appendChild(rm);
                }
                b.appendChild(card);
            });
            if (profiles().length < MAX_PROFILES) {
                const add = el('button', 'btn', 'Add a profile'); add.type = 'button';
                add.prepend(icon('plus'));
                add.onclick = async () => {
                    const id = `p${Date.now().toString(36)}`;
                    await mutate(x => x.profiles.push({ id, name: `Profile ${x.profiles.length + 1}`, main: false, follow: { addons: true, prefs: true }, addons: [], prefs: {} }));
                    viewManage();
                };
                b.appendChild(add);
            }
        });
    }

    async function viewDevices() {
        const code = pendingLink; pendingLink = null;
        show(b => {
            const back = el('button', 'back-btn'); back.type = 'button';
            back.append(icon('chevron-left'), document.createTextNode('Account'));
            back.onclick = viewMenu;
            b.appendChild(back);
            b.appendChild(el('h2', null, 'Devices & TVs'));
            const list = el('div', 'device-list');
            b.appendChild(list);
            b.appendChild(el('h3', 'sub-section', 'Add a TV'));
            b.appendChild(el('p', 'acct-note', 'Open Reddate on your TV. It shows a code and a QR code — scan the QR with this phone, or type the code here.'));
            const c = field('TV code', 'text', 'tvcode', { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD-EFGH', maxlength: '9' });
            const err = errorBox();
            const result = el('div', 'tv-confirm');
            const btn = primary('Look up TV');
            b.appendChild(form(async () => {
                err.textContent = ''; result.innerHTML = '';
                const val = c.input.value.trim();
                if (!val) { err.textContent = 'Enter the code shown on the TV.'; return; }
                await working(btn, 'Looking…', async () => {
                    const r = await api(`/api/device/lookup?code=${encodeURIComponent(val)}`);
                    if (!r.ok) { err.textContent = r.data.error || 'That code isn’t valid.'; return; }
                    result.appendChild(el('p', 'acct-note', `Add “${r.data.name}” to your account?`));
                    result.appendChild(el('p', 'acct-hint', 'Only continue if you’re looking at this code on your own TV right now.'));
                    const ok = el('button', 'btn btn-primary', 'Yes, add it'); ok.type = 'button';
                    ok.onclick = async () => {
                        ok.disabled = true;
                        const a = await api('/api/device/approve', { method: 'POST', body: { code: val } });
                        if (!a.ok) { err.textContent = a.data.error || 'Couldn’t add the TV.'; ok.disabled = false; return; }
                        toast(`${r.data.name} is signed in`);
                        // A phone or computer that just added a TV: carry on to the set-up page (in a new tab it opens its own links).
                        if (!document.documentElement.classList.contains('tv')) { location.href = '/setup?tv=' + encodeURIComponent(r.data.name); return; }
                        viewDevices();
                    };
                    result.appendChild(ok);
                });
            }, c.wrap, err, btn, result));
            if (code) { c.input.value = code; btn.click(); }

            api('/api/devices').then(r => {
                list.innerHTML = '';
                if (!r.ok) { list.appendChild(el('p', 'acct-error', r.data.error || 'Couldn’t load devices.')); return; }
                r.data.devices.forEach(d => {
                    const row = el('div', 'device-row');
                    const info = el('div', 'device-info');
                    info.appendChild(el('div', 'device-name', d.name + (d.current ? ' (this device)' : '')));
                    info.appendChild(el('div', 'device-meta', `${d.kind === 'tv' ? 'TV' : 'Browser'} · last used ${new Date(d.lastSeen).toLocaleDateString()}`));
                    row.appendChild(info);
                    if (!d.current) {
                        const rm = el('button', 'addon-remove', 'Remove'); rm.type = 'button';
                        rm.onclick = async () => { await api(`/api/devices/${d.id}`, { method: 'DELETE' }); viewDevices(); };
                        row.appendChild(rm);
                    }
                    list.appendChild(row);
                });
            });
        });
    }

    function viewMenu() {
        if (!isSignedIn()) { viewSignIn(); return; }
        // Confirmed in a browser or on the phone meanwhile? Don't keep asking.
        if (!verified) api('/api/vault').then(r => { if (r.ok && r.data.verified !== false) { verified = true; viewMenu(); } });
        show(b => {
            const p = activeProfile();
            const head = el('div', 'acct-head');
            head.appendChild(el('span', 'avatar big', (p.name || '?').trim().charAt(0).toUpperCase() || '?'));
            const who = el('div');
            who.appendChild(el('div', 'acct-who', p.name));
            who.appendChild(el('div', 'acct-meta', email || ''));
            head.appendChild(who);
            b.appendChild(head);
            if (!verified) {
                const n = el('div', 'acct-verify');
                n.appendChild(el('p', null, `Confirm ${email} so you can reset your password if you ever forget it. The link is in your inbox.`));
                const again = linkBtn('Send the link again', async () => {
                    again.disabled = true;
                    const r = await api('/api/auth/resend', { method: 'POST' });
                    if (r.ok && r.data.verified) { verified = true; viewMenu(); return; }
                    again.textContent = r.ok ? 'Sent. Check your inbox (and spam).' : (r.data.error || 'Couldn’t send it. Try again later.');
                });
                n.appendChild(again);
                b.appendChild(n);
            }
            const menu = el('div', 'acct-menu');
            const item = (text, ic, fn, cls) => { const x = el('button', `acct-item ${cls || ''}`); x.type = 'button'; x.append(icon(ic), document.createTextNode(text)); x.onclick = fn; menu.appendChild(x); };
            if (profiles().length > 1) item('Switch profile', 'users', viewWho);
            item('Manage profiles', 'user', viewManage);
            item('Devices & TVs', 'tv', viewDevices);
            item('Set up Reddate', 'user', () => { window.open('/setup', '_blank', 'noopener'); });
            item('Sign out', 'log-out', async () => { await api('/api/auth/logout', { method: 'POST' }); clearSession(); close(); toast('Signed out'); });
            item('Delete account', 'trash', viewDelete, 'danger');
            b.appendChild(menu);
        });
    }

    function viewDelete() {
        show(b => {
            const back = el('button', 'back-btn'); back.type = 'button';
            back.append(icon('chevron-left'), document.createTextNode('Account'));
            back.onclick = viewMenu;
            b.appendChild(back);
            b.appendChild(el('h2', null, 'Delete your account'));
            b.appendChild(el('p', 'acct-note', 'This permanently deletes your account, profiles and saved addons, and signs out every device. It can’t be undone.'));
            const p = field('Password', 'password', 'password', { autocomplete: 'current-password' });
            const err = errorBox();
            const btn = primary('Delete everything'); btn.classList.add('danger-btn');
            b.appendChild(form(async () => {
                err.textContent = '';
                if (!p.input.value) { err.textContent = 'Enter your password to confirm.'; return; }
                await working(btn, 'Deleting…', async () => {
                    const r = await api('/api/account/delete', { method: 'POST', body: { password: p.input.value } });
                    if (!r.ok) { err.textContent = r.data.error || 'Couldn’t delete the account.'; return; }
                    clearSession(); close(); toast('Account deleted');
                });
            }, p.wrap, err, btn));
        });
    }

    // ---------- the button in the top bar + the welcome screen ----------
    function updateChrome() {
        const btn = $('accountBtn');
        if (btn) {
            btn.hidden = !enabled;
            const p = isSignedIn() ? activeProfile() : null;
            btn.classList.toggle('signed-in', !!p);
            btn.setAttribute('aria-label', p ? `Account: ${p.name}` : 'Sign in');
            btn.title = p ? `${p.name} · account` : 'Sign in';
            const slot = btn.querySelector('.acct-slot');
            slot.textContent = '';
            if (p) slot.textContent = (p.name || '?').trim().charAt(0).toUpperCase() || '?';
            else slot.appendChild(icon('user'));
        }
        const lobby = $('lobbyAccount');
        if (lobby) {
            lobby.hidden = !enabled;
            lobby.innerHTML = '';
            if (isSignedIn()) {
                const p = activeProfile();
                lobby.appendChild(el('span', null, `Signed in as ${p.name}`));
                lobby.appendChild(linkBtn(profiles().length > 1 ? 'Switch' : 'Account', open));
                const name = $('usernameInput');
                if (name && !name.dataset.touched) name.value = p.name;
            } else {
                lobby.appendChild(linkBtn('Sign in to use your saved profile and addons', open));
            }
        }
    }

    function open() { isSignedIn() ? viewMenu() : viewSignIn(); }

    // ---------- links from emails / QR codes ----------
    async function handleUrl() {
        const params = new URLSearchParams(location.search);
        const strip = () => history.replaceState(null, '', location.pathname + location.hash);
        if (params.has('verify')) {
            const t = params.get('verify'); strip();
            const r = await api('/api/auth/verify', { method: 'POST', auth: false, body: { token: t } });
            if (r.ok) verified = true;
            if (r.ok && isSignedIn()) { toast('Email confirmed'); return; }
            viewSignIn(r.ok ? 'Email confirmed. Sign in to continue.' : (r.data.error || 'That link is invalid.'));
        } else if (params.has('reset')) {
            const t = params.get('reset'); strip();
            viewReset(t);
        } else if (params.has('open')) {
            const what = params.get('open'); strip();
            const go = () => {
                if (!isSignedIn()) { viewSignIn('Sign in to continue.'); return; }
                if (what === 'devices') viewDevices();
                else if (what === 'profiles') viewManage();
                else if (what === 'account') viewMenu();
                else if (what === 'addons' && window.reddatePages && window.reddatePages.openAddons) {
                    if (window.reddateRoom && !window.reddateRoom.isInRoom()) window.reddateRoom.showHome(); // the Addons page sits on Home
                    window.reddatePages.openAddons(params.get('tab') || undefined);
                }
            };
            setTimeout(go, 400);
        } else if (params.has('link')) {
            pendingLink = params.get('link'); strip();
            if (isSignedIn()) viewDevices(); else viewSignIn('Sign in to add your TV.');
        }
    }

    // Tells other scripts (the TV screens) that sign-in state is known.
    let ready = false;
    function announceReady() {
        ready = true;
        document.dispatchEvent(new CustomEvent('reddate:account-ready', { detail: { enabled, signedIn: isSignedIn() } }));
    }

    // A TV that was approved on a phone already holds its own token: adopt it and load the profiles.
    async function adoptToken(t) {
        token = t;
        try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
        await restore();
        changed();
        return isSignedIn();
    }
    function chooseProfile(id) { if (profiles().some(p => p.id === id)) setActive(id); }
    // Profile management from the TV (the same changes the phone's Profiles page makes).
    async function addProfile(name) {
        if (!isSignedIn() || profiles().length >= MAX_PROFILES) return null;
        const id = `p${Date.now().toString(36)}`;
        const nm = String(name || '').trim().slice(0, 24) || `Profile ${profiles().length + 1}`;
        const ok = await mutate(x => { if (x.profiles.length < MAX_PROFILES) x.profiles.push({ id, name: nm, main: false, follow: { addons: true, prefs: true }, addons: [], prefs: {} }); });
        return ok ? id : null;
    }
    async function renameProfile(id, name) {
        const nm = String(name || '').trim().slice(0, 24);
        if (!isSignedIn() || !nm) return false;
        return mutate(x => { const p = x.profiles.find(q => q.id === id); if (p) p.name = nm; });
    }
    async function removeProfile(id) {
        const p = profiles().find(q => q.id === id);
        if (!isSignedIn() || !p || p.main) return false;
        const wasActive = activeProfile().id === id;
        const ok = await mutate(x => { x.profiles = x.profiles.filter(q => q.id !== id); });
        if (wasActive) setActive(mainProfile().id);
        return ok;
    }

    async function init() {
        const cfg = await fetch('/api/auth/config').then(r => r.json()).catch(() => ({ enabled: false }));
        turnstileKey = (cfg && typeof cfg.turnstile === 'string') ? cfg.turnstile : '';
        // The browser app's address (reddate.tv): QR codes and invite links on the TV point there.
        window.reddateWebOrigin = cfg && typeof cfg.web === 'string' && /^https:\/\//.test(cfg.web) ? cfg.web.replace(/\/$/, '') : '';
        enabled = !!cfg.enabled;
        if (!enabled) { updateChrome(); announceReady(); return; }
        await restore();
        updateChrome();
        document.dispatchEvent(new CustomEvent('reddate:account'));
        announceReady();
        $('accountBtn').addEventListener('click', open);
        const name = $('usernameInput');
        if (name) name.addEventListener('input', () => { name.dataset.touched = '1'; });
        handleUrl();
    }

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    // A safety net if the live message was missed: every 30 s on a TV (nobody is there to reload the page), else 90 s.
    setInterval(refresh, document.documentElement.classList.contains('tv') || /[?&]tv=1/.test(location.search) ? 30000 : 90000);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    return {
        isSignedIn, getAddons, addAddon, removeAddon, removeAddons, getPref, setPref, open, adoptToken, chooseProfile, addProfile, renameProfile, removeProfile,
        openManage: () => { if (isSignedIn()) viewManage(); else viewSignIn(); },
        sessionToken: () => (isSignedIn() ? token : null), deviceName, refresh, api,
        isEnabled: () => enabled, isReady: () => ready,
        profiles: () => profiles().map(p => ({ id: p.id, name: p.name, main: !!p.main })),
        activeProfileId: () => (isSignedIn() ? activeProfile().id : null),
        profileName: () => (isSignedIn() ? activeProfile().name : null),
        email: () => (isSignedIn() ? email : null),
        verified: () => verified,
        async resendConfirm() {
            const r = await api('/api/auth/resend', { method: 'POST' });
            if (r.ok && r.data.verified) { verified = true; return { ok: true, verified: true }; }
            return { ok: r.ok, error: r.ok ? '' : (r.data.error || 'Couldn’t send it. Try again later.') };
        },
        async signOut() { await api('/api/auth/logout', { method: 'POST' }); clearSession(); }
    };
})();

// Preferences that follow the account when signed in and stay on this device otherwise.
window.reddatePrefs = (function () {
    const A = () => window.reddateAccount;
    const key = k => `reddate-pref-${k}`;
    return {
        hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); },
        get(k, fallback) {
            if (A().isSignedIn()) { const v = A().getPref(k); return v === undefined ? fallback : v; }
            try { const raw = localStorage.getItem(key(k)); return raw === null ? fallback : JSON.parse(raw); } catch (e) { return fallback; }
        },
        set(k, val) {
            if (A().isSignedIn()) A().setPref(k, val);
            else { try { localStorage.setItem(key(k), JSON.stringify(val)); } catch (e) { /* private mode */ } }
            document.dispatchEvent(new CustomEvent('reddate:prefs'));
        }
    };
})();
