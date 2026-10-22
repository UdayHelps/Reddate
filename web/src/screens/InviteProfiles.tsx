import React, { useEffect, useState } from 'react';
import { engine, Json } from '../engine';
import { useApp } from '../App';

/** Your other open screens (any profile on this account): invite them straight into the party. Refreshes
 *  every few seconds, so a TV or tab opened just now appears. */
export function InviteProfiles() {
    const { toast } = useApp();
    const [devices, setDevices] = useState<Json[] | null>(null);
    const [sent, setSent] = useState<Record<string, boolean>>({});
    useEffect(() => {
        const load = () => engine.call<Json[]>('devices', {}, 8000).then(d => setDevices(Array.isArray(d) ? d : [])).catch(() => setDevices(x => x || []));
        load();
        const t = window.setInterval(load, 3000);
        return () => window.clearInterval(t);
    }, []);
    return (
        <div style={{ marginBottom: 14, textAlign: 'left' }}>
            <div className="note" style={{ marginBottom: 6, letterSpacing: '.06em' }}>YOUR PROFILES</div>
            {devices === null ? <p className="note">Looking for your other screens…</p>
                : devices.length === 0 ? <p className="note">None of your other screens are open right now. Open Reddate on the TV or another browser, signed in to this account, and it shows up here.</p>
                    : (
                        <>
                            {devices.length > 1 && <button className="opt" onClick={() => { engine.call('inviteAll').catch(() => {}); setSent(Object.fromEntries(devices.map(d => [d.id, true]))); toast('Invites sent'); }}><b>Invite all my profiles</b></button>}
                            {devices.map(d => (
                                <button key={d.id} className="opt" onClick={() => { engine.call('inviteDevice', { id: d.id }).catch(() => {}); setSent(x => ({ ...x, [d.id]: true })); toast(`Invite sent to ${d.profile || d.device}`); }}>
                                    <span>{d.profile || d.device}<small>{[d.profile ? d.device : '', sent[d.id] ? 'Invite sent' : 'Invite'].filter(Boolean).join(' · ')}</small></span>
                                </button>
                            ))}
                        </>
                    )}
        </div>
    );
}
