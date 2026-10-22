import { Wordmark } from '../icons';
import React, { useEffect, useState } from 'react';
import { engine } from '../engine';
import { useApp } from '../App';

export function Auth({ joinCode, tvCode }: { joinCode: string; tvCode?: string }) {
    const { refresh, go } = useApp();
    const [mode, setMode] = useState<'in' | 'up'>('in');
    const [email, setEmail] = useState('');
    // Behind the form: tonight's trending backdrops from the Reddate Catalog, fading one into the next.
    const [art, setArt] = useState<string[]>([]);
    useEffect(() => {
        fetch('/catalog/catalog/movie/trending.json').then(r => r.ok ? r.json() : null).then(d => {
            const list = ((d && d.metas) || []).map((m: { background?: string }) => m.background).filter(Boolean).slice(0, 3);
            if (list.length) setArt(list);
        }).catch(() => {});
    }, []);
    const [pw, setPw] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [code, setCode] = useState('');
    useEffect(() => { try { setEmail(localStorage.getItem('rd-email') || ''); } catch { /* fine */ } }, []);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (busy) return;
        setBusy(true); setErr('');
        try {
            const r = await fetch(mode === 'in' ? '/api/auth/login' : '/api/auth/register', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), password: pw })
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.token) { setErr(d.error || 'That didn’t work. Check your details and try again.'); return; }
            try { localStorage.setItem('rd-email', email.trim()); } catch { /* fine */ }
            if (mode === 'up') { try { sessionStorage.setItem('rd-new', '1'); } catch { /* fine */ } }
            await engine.call('adoptToken', { token: d.token }, 20000);
            await refresh();
            if (joinCode) { try { await engine.call('joinCode', { code: joinCode }, 20000); } catch { /* the watch screen says why */ } go('/watch', true); }
        } catch (ex: any) {
            setErr(ex && ex.message ? ex.message : 'Couldn’t reach the server.');
        } finally { setBusy(false); }
    }
    async function joinAsGuest() { setErr('Parties are for signed-in people. Sign in or create a free account to join.'); }

    return (
        <div className="auth split">
            <div className="auth-art" aria-hidden="true">
                {art.map((src, i) => <img key={src} src={src} alt="" style={{ animationDelay: `${i * 6 - 18}s` }} className={art.length > 1 ? 'fade' : ''} />)}
                <div className="auth-say"><h1>Movie night, sorted.</h1><p>Watch in sync with everyone, from any screen.</p></div>
            </div>
            <form className="card" onSubmit={submit}>
                <div className="wordmark"><Wordmark size={40} /></div>
                <p className="note" style={{ marginBottom: 18 }}>
                    {tvCode ? `Sign in to add your TV (code ${tvCode.slice(0, 4)}-${tvCode.slice(4)}). It signs itself in as you.` : joinCode ? `Sign in to join the party ${joinCode.toUpperCase()}.` : 'Watch together in sync. Your addons, your profiles, one party code.'}
                </p>
                <div className="field"><label htmlFor="em">Email</label><input id="em" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
                <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={pw} onChange={e => setPw(e.target.value)} required minLength={mode === 'up' ? 8 : 1} />
                    {mode === 'up' && <span className="note">At least 8 characters.</span>}</div>
                <div className="err" role="alert">{err}</div>
                <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
                <p className="note" style={{ marginTop: 16, textAlign: 'center' }}>
                    {mode === 'in' ? 'New here? ' : 'Already have an account? '}
                    <a href="#" onClick={e => { e.preventDefault(); setMode(mode === 'in' ? 'up' : 'in'); setErr(''); }}>{mode === 'in' ? 'Create an account' : 'Sign in'}</a>
                </p>
                {!joinCode && !tvCode && (
                    <div className="auth-code">
                        <div className="field" style={{ marginBottom: 0 }}>
                            <label htmlFor="jc">Have a party code?</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input id="jc" className="input" placeholder="ABCD-EFGH" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={12} />
                                <button type="button" className="btn" onClick={() => { if (code.replace(/[^A-Z0-9]/g, '').length >= 6) go('/join/' + code.replace(/[^A-Z0-9]/g, '')); else joinAsGuest(); }}>Join</button>
                            </div>
                        </div>
                    </div>
                )}
                <p className="note" style={{ marginTop: 16, textAlign: 'center' }}><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
            </form>
        </div>
    );
}
