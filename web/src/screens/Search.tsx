import React, { useEffect, useRef, useState } from 'react';
import { engine, Json } from '../engine';
import { Meta, parseMeta } from '../util';
import { PosterCard } from './Poster';
import { RowView, Row } from './Home';
import { ISearch, IX } from '../icons';

const KEY = 'rd-recent-searches';
const load = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };

export function Search() {
    const [q, setQ] = useState('');
    const [res, setRes] = useState<Meta[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [recent, setRecent] = useState<string[]>(load);
    const seq = useRef(0);
    // With nothing typed yet, the page shows what's trending instead of an empty screen.
    const [rows, setRows] = useState<Row[]>([]);
    useEffect(() => { engine.call<Row[]>('rows', {}, 40000).then(r => setRows((r || []).slice(0, 2))).catch(() => {}); }, []);

    async function run(text: string) {
        const t = text.trim();
        if (t.length < 2) { setRes(null); return; }
        const my = ++seq.current;
        setBusy(true);
        try {
            const r = await engine.call<Json[]>('search', { q: t }, 30000);
            if (my !== seq.current) return;
            const list = r.map(m => parseMeta(m)).filter(m => m.id && m.poster);
            setRes(list);
            if (list.length) {
                const next = [t, ...recent.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 12);
                setRecent(next);
                try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* fine */ }
            }
        } catch { if (my === seq.current) setRes([]); } finally { if (my === seq.current) setBusy(false); }
    }
    useEffect(() => { const t = setTimeout(() => run(q), 550); return () => clearTimeout(t); }, [q]);
    const store = (l: string[]) => { setRecent(l); try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* fine */ } };

    // Rows: series, movies, YouTube channels, YouTube videos, then anything else.
    const all = res || [];
    const isYt = (m: Meta) => m.id.startsWith('yt:');
    const channels = all.filter(m => m.type === 'channel');
    const videos = all.filter(m => isYt(m) && m.type !== 'channel');
    const series = all.filter(m => (m.type === 'series' || m.type === 'anime') && !isYt(m));
    const movies = all.filter(m => m.type === 'movie' && !isYt(m));
    const other = all.filter(m => ![channels, videos, series, movies].some(g => g.includes(m)));
    return (
        <main className="page">
            <form className="bigsearch" onSubmit={e => { e.preventDefault(); run(q); }}>
                <ISearch width={26} height={26} />
                <input autoFocus placeholder="Search movies and shows" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
                {q && <button type="button" className="btn small ghost" aria-label="Clear" onClick={() => setQ('')}><IX width={16} height={16} /></button>}
            </form>
            {!q.trim() && recent.length > 0 && (
                <section className="recent">
                    <div className="row-head"><h2>Recent searches</h2><button className="btn small ghost" onClick={() => store([])}>Clear all</button></div>
                    <div className="recent-chips">
                        {recent.map(r => (
                            <span className="chip" key={r}>
                                <button onClick={() => setQ(r)}>{r}</button>
                                <button aria-label={`Remove ${r}`} onClick={() => store(recent.filter(x => x !== r))}><IX width={14} height={14} /></button>
                            </span>
                        ))}
                    </div>
                </section>
            )}
            {!q.trim() && rows.map(r => <RowView key={r.key} row={r} />)}
            {busy && !res && <p className="note" style={{ marginTop: 20 }}>Searching…</p>}
            {res && res.length === 0 && !busy && <p className="note" style={{ marginTop: 20 }}>Nothing found. Try other words.</p>}
            {[['Series', series], ['Movies', movies], ['Channels', channels], ['YouTube', videos], ['Other', other]].map(([title, list]) => (list as Meta[]).length > 0 && (
                <section key={title as string}>
                    <div className="row-head"><h2>{title as string} <span className="note">· {(list as Meta[]).length}</span></h2></div>
                    <div className="grid">{(list as Meta[]).map(m => <PosterCard key={m.id} m={m} />)}</div>
                </section>
            ))}
        </main>
    );
}
