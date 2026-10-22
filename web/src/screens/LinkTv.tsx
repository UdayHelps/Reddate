import { Wordmark } from '../icons';
import React, { useEffect, useState } from 'react';
import { authApi } from '../api';
import { useApp } from '../App';

/** A TV showed a QR code or a code: confirm it's theirs, then sign it in. */
export function LinkTv({ code, onDone }: { code: string; onDone: () => void }) {
    const { st } = useApp();
    const [name, setName] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    useEffect(() => {
        authApi(`/api/device/lookup?code=${encodeURIComponent(code)}`).then(r => {
            if (r.ok) setName(String(r.data.name || 'your TV')); else { try { sessionStorage.removeItem('rd-link'); } catch { /* fine */ } setErr(r.data.error || 'That code isn’t valid or has expired. Look at the TV for a new one.'); }
        });
    }, [code]);
    async function approve() {
        setBusy(true); setErr('');
        const r = await authApi('/api/device/approve', { method: 'POST', body: { code } });
        setBusy(false);
        if (r.ok) { try { sessionStorage.removeItem('rd-link'); } catch { /* fine */ } setDone(true); } else setErr(r.data.error || 'Couldn’t sign in the TV. Try again.');
    }
    return (
        <div className="auth">
            <div className="card" style={{ textAlign: 'center' }}>
                <div className="wordmark"><Wordmark size={40} /></div>
                {done ? (
                    <>
                        <h2>{name} is signed in</h2>
                        <p className="note" style={{ margin: '8px 0 18px' }}>Look at your TV. It’s opening Reddate as {st.profile || 'you'} now.</p>
                        <button className="btn primary" onClick={onDone}>Done</button>
                    </>
                ) : err ? (
                    <>
                        <h2>Couldn’t add the TV</h2>
                        <p className="note" style={{ margin: '8px 0 18px' }}>{err}</p>
                        <button className="btn" onClick={onDone}>Back</button>
                    </>
                ) : name ? (
                    <>
                        <h2>Sign in “{name}”?</h2>
                        <p className="note" style={{ margin: '8px 0 6px' }}>Code <b>{code.slice(0, 4)}-{code.slice(4)}</b></p>
                        <p className="note" style={{ marginBottom: 18 }}>Only continue if you’re looking at this code on your own TV right now.</p>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                            <button className="btn primary" disabled={busy} onClick={approve}>{busy ? 'Signing in…' : 'Yes, sign it in'}</button>
                            <button className="btn ghost" onClick={onDone}>Cancel</button>
                        </div>
                    </>
                ) : <><div className="spin" /><p className="note">Checking the code…</p></>}
            </div>
        </div>
    );
}
