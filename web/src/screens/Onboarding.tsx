import { Wordmark } from '../icons';
import React, { useEffect, useState } from 'react';
import { engine, Json } from '../engine';
import { useApp } from '../App';

const STEPS = ['Name', 'Addons', 'TV', 'Done'];

/** First time here: a few short steps, each skippable, and a way out to the app at any point. */
export function Onboarding({ onFinish }: { onFinish: (to?: string) => void }) {
    const { st, refresh, toast } = useApp();
    const [step, setStep] = useState(0);
    const main = st.profiles.find(p => p.main) || st.profiles[0];
    const [name, setName] = useState(main && main.name !== 'Me' ? main.name : '');
    const [busy, setBusy] = useState(false);
    const [url, setUrl] = useState('');
    const [err, setErr] = useState('');
    const [added, setAdded] = useState<string[]>([]);
    const [sugg, setSugg] = useState<Json[]>([]);
    const [tvCode, setTvCode] = useState('');
    const [tvErr, setTvErr] = useState('');

    useEffect(() => { if (step === 1) engine.call<Json[]>('addonSuggested', {}, 20000).then(setSugg).catch(() => {}); }, [step]);

    async function saveName() {
        const n = name.trim();
        if (n && main && n !== main.name) {
            setBusy(true);
            try { await engine.call('renameProfile', { id: main.id, name: n }, 20000); await refresh(); } catch (e: any) { toast(e.message); }
            setBusy(false);
        }
        setStep(1);
    }
    async function addAddon(u: string) {
        if (!u.trim() || busy) return;
        setBusy(true); setErr('');
        try {
            const r = await engine.call<Json>('addonAdd', { url: u.trim() }, 40000);
            if (r && r.ok === false) setErr(r.message || r.error || 'That isn’t a working addon link.');
            else { setAdded(a => [...a, u.trim()]); setUrl(''); }
        } catch (e: any) { setErr(e.message || 'Couldn’t add that.'); }
        setBusy(false);
    }
    function addTv(e: React.FormEvent) {
        e.preventDefault();
        const c = tvCode.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (c.length < 8) { setTvErr('Enter the 8-character code shown on the TV.'); return; }
        try { sessionStorage.setItem('rd-link', c); } catch { /* fine */ }
        onFinish('/'); location.reload();
    }

    return (
        <div className="auth" style={{ alignContent: 'center' }}>
            <div className="card" style={{ width: 'min(560px,100%)', padding: 28, position: 'relative' }}>
                <button className="btn small ghost" style={{ position: 'absolute', right: 16, top: 16 }} onClick={() => onFinish()}>Skip to the app</button>
                <div className="wordmark"><Wordmark size={40} /></div>
                <div style={{ display: 'flex', gap: 6, margin: '8px 0 18px' }} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
                    {STEPS.map((s, i) => <span key={s} style={{ height: 5, flex: 1, borderRadius: 3, background: i <= step ? 'var(--accent)' : 'var(--paper3)' }} />)}
                </div>

                {step === 0 && (
                    <>
                        <h1 style={{ fontSize: 28 }}>Welcome. What should we call you?</h1>
                        <p className="note" style={{ margin: '6px 0 16px' }}>This is your profile name. Friends in a party see it. You can add more profiles later, each with its own history.</p>
                        <div className="field"><label htmlFor="ob-n">Your name</label><input id="ob-n" autoFocus maxLength={24} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveName(); }} placeholder="e.g. Uday" /></div>
                        <div style={{ display: 'flex', gap: 10 }}><button className="btn primary" disabled={busy} onClick={saveName}>{busy ? 'Saving…' : 'Continue'}</button><button className="btn ghost" onClick={() => setStep(1)}>Not now</button></div>
                    </>
                )}

                {step === 1 && (
                    <>
                        <h1 style={{ fontSize: 28 }}>Add your addons</h1>
                        <p className="note" style={{ margin: '6px 0 14px' }}>Addons give Reddate its movies and shows. <b>Catalog</b> addons fill Home, <b>stream</b> addons give you something to play, <b>subtitle</b> addons add subtitles. Paste a link, or add one of the suggestions.</p>
                        {sugg.filter(s => !added.includes(s.url)).slice(0, 3).map(s => (
                            <div className="item" key={s.url} style={{ marginBottom: 8 }}>
                                <div className="grow"><b>{s.name}</b><span className="note">{s.description}</span></div>
                                <button className="btn small" disabled={busy} onClick={() => addAddon(s.url)}>Add</button>
                            </div>
                        ))}
                        <form onSubmit={e => { e.preventDefault(); addAddon(url); }} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <input className="input" placeholder="https://…/manifest.json" value={url} onChange={e => setUrl(e.target.value)} aria-label="Addon link" />
                            <button className="btn primary" disabled={busy || !url.trim()}>{busy ? 'Adding…' : 'Add'}</button>
                        </form>
                        <div className="err">{err}</div>
                        {added.length > 0 && <p className="note" style={{ color: '#7ddc9a' }}>{added.length} addon{added.length === 1 ? '' : 's'} added.</p>}
                        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                            <button className="btn primary" onClick={() => setStep(2)}>{added.length ? 'Continue' : 'Skip for now'}</button>
                            <button className="btn ghost" onClick={() => setStep(0)}>Back</button>
                        </div>
                    </>
                )}

                {step === 2 && (
                    <>
                        <h1 style={{ fontSize: 28 }}>Got a TV?</h1>
                        <p className="note" style={{ margin: '6px 0 16px' }}>Open Reddate on your TV. It shows a code and a QR code. Type the code here (or scan the QR with this phone) and the TV signs in as you.</p>
                        <form onSubmit={addTv} style={{ display: 'flex', gap: 8 }}>
                            <input className="input" placeholder="ABCD-EFGH" maxLength={9} value={tvCode} onChange={e => { setTvCode(e.target.value.toUpperCase()); setTvErr(''); }} aria-label="TV code" />
                            <button className="btn primary">Add TV</button>
                        </form>
                        <div className="err">{tvErr}</div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                            <button className="btn" onClick={() => setStep(3)}>I’ll do this later</button>
                            <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
                        </div>
                    </>
                )}

                {step === 3 && (
                    <>
                        <h1 style={{ fontSize: 28 }}>You’re all set{name.trim() ? `, ${name.trim()}` : ''}.</h1>
                        <p className="note" style={{ margin: '6px 0 18px' }}>Find something on Home, press <b>Watch together</b> on its page, and share the code. Everything here also works on your TV.</p>
                        <button className="btn primary" onClick={() => onFinish()}>Start watching</button>
                    </>
                )}
            </div>
        </div>
    );
}
