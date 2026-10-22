import React, { useEffect, useRef, useState } from 'react';
import { engine, Json } from '../engine';
import { useApp } from '../App';
import { Meta, parseMeta, clock } from '../util';
import { PosterCard } from './Poster';
import { IPlay } from '../icons';

export interface Row { key: string; title: string; type: string; url: string }
interface Cw { k: string; id: string; t: string; sh: string; n: string; a: string; p: number; d: number; next?: number }

export function RowView({ row }: { row: Row }) {
    const [items, setItems] = useState<Meta[] | null>(null);
    const [failed, setFailed] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        let started = false;
        const load = () => {
            if (started) return; started = true;
            engine.call<Json>('getJson', { url: row.url }, 25000).then(o => {
                const list = (o && o.metas ? o.metas : []).map((m: Json) => parseMeta(m, row.type)).filter((m: Meta) => m.id && m.poster && m.name !== 'Untitled');
                const seen = new Set<string>();
                const uniq = list.filter((m: Meta) => (seen.has(m.id) ? false : (seen.add(m.id), true))).slice(0, 36);
                if (!uniq.length) setFailed(true); else setItems(uniq);
            }).catch(() => setFailed(true));
        };
        const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { load(); io.disconnect(); } }, { rootMargin: '600px' });
        io.observe(el);
        return () => io.disconnect();
    }, [row.url, row.type]);
    const rank = /top\s*10/i.test(row.title);
    if (failed) return null;
    return (
        <section ref={ref}>
            <div className="row-head"><h2>{row.title}</h2></div>
            {/* Top 10 rows show their rank as a big outlined number beside each poster, as on the TV. */}
            <div className={'rail' + (rank ? ' rank' : '')}>
                {items ? items.map((m, i) => rank && i < 10
                    ? <div key={m.id} className="ranked"><span className="num" aria-hidden="true">{i + 1}</span><PosterCard m={m} /></div>
                    : <PosterCard key={m.id} m={m} />) : Array.from({ length: 8 }, (_, i) => <div key={i} className="poster"><div className="img skeleton" /></div>)}
            </div>
        </section>
    );
}

export function Home() {
    const { go, st, metaCache } = useApp();
    const [rows, setRows] = useState<Row[] | null>(null);
    const [cw, setCw] = useState<Cw[]>([]);
    const [hero, setHero] = useState<Meta | null>(null);

    const loadCw = () => engine.call<Cw[]>('continueRow', {}).then(setCw).catch(() => {});
    const load = () => {
        engine.call<Row[]>('rows', {}, 40000).then(r => setRows(r)).catch(() => setRows([]));
        loadCw();
    };
    useEffect(() => {
        load();
        // What you watched on the TV or another device: pull it now, and again whenever this tab comes back.
        const pull = () => engine.call('refreshVault', {}, 25000).then(loadCw).catch(() => {});
        pull();
        const onVis = () => { if (!document.hidden) pull(); };
        document.addEventListener('visibilitychange', onVis);
        const t = window.setInterval(pull, 45000);
        const off = engine.on(ev => { if (ev.type === 'home-changed') load(); });
        return () => { off(); window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
    }, [st.profileId]);

    // The hero: the first title of the first row that has a wide picture.
    useEffect(() => {
        if (!rows || !rows.length) return;
        let dead = false;
        (async () => {
            for (const r of rows.slice(0, 3)) {
                try {
                    const o = await engine.call<Json>('getJson', { url: r.url }, 20000);
                    const m = (o.metas || []).map((x: Json) => parseMeta(x, r.type)).find((x: Meta) => x.background && x.description);
                    if (m && !dead) { setHero(m); return; }
                } catch { /* next */ }
            }
        })();
        return () => { dead = true; };
    }, [rows]);

    function resume(c: Cw) {
        go(`/title/${encodeURIComponent(c.t)}/${encodeURIComponent(c.sh || c.id)}?resume=${encodeURIComponent(c.k)}`);
    }

    return (
        <main className="page">
            {hero && (
                <section className="hero" aria-label="Featured">
                    <img className="bg" src={hero.background} alt="" />
                    <div className="in">
                        <div className="kicker">{hero.type === 'series' ? 'Series' : 'Movie'}</div>
                        <h1>{hero.name}</h1>
                        <div className="meta">{[hero.releaseInfo, hero.rating && `★ ${hero.rating}`, hero.genres.slice(0, 2).join(' · ')].filter(Boolean).join('  ·  ')}</div>
                        <p>{hero.description}</p>
                        <div className="hero-cta">
                            <button className="btn primary lg" onClick={() => { metaCache.set(`${hero.type}:${hero.id}`, hero); go(`/title/${encodeURIComponent(hero.type)}/${encodeURIComponent(hero.id)}`); }}><IPlay /> Watch</button>
                            <button className="btn lg" onClick={() => go("/watch")}>Join a party</button>
                        </div>
                    </div>
                </section>
            )}
            {cw.length > 0 && (
                <section>
                    <div className="row-head"><h2>Continue watching</h2></div>
                    <div className="rail">
                        {cw.map(c => (
                            <a key={c.k} className="poster wide" href="#" onClick={e => { e.preventDefault(); resume(c); }}>
                                <div className="img">
                                    {c.a.startsWith('http') && <img loading="lazy" alt="" src={c.a} />}
                                    {c.d > 0 && <div className="bar"><i style={{ width: `${Math.min(100, Math.round(c.p / c.d * 100))}%` }} /></div>}
                                </div>
                                <div className="t">{c.n}{c.d > 0 && !c.next ? ` · ${clock(Math.max(0, c.d - c.p))} left` : c.next ? ' · Up next' : ''}</div>
                            </a>
                        ))}
                    </div>
                </section>
            )}
            {cw.length === 0 && st.profiles.length > 1 && (
                <p className="note" style={{ margin: '14px 2px 0' }}>Continue watching is kept per profile. You’re on <b>{st.profile}</b>. <a href="/profiles" onClick={e => { e.preventDefault(); go('/profiles'); }}>Switch profile</a> to see another one’s.</p>
            )}
            {rows === null && <div style={{ marginTop: 28 }}><div className="skeleton" style={{ height: 190, borderRadius: 14 }} /></div>}
            {rows && rows.length === 0 && (
                <div className="card" style={{ marginTop: 24 }}>
                    <h2>No rows yet</h2>
                    <p className="note" style={{ margin: '6px 0 14px' }}>Add an addon to fill Home with movies and shows.</p>
                    <button className="btn primary" onClick={() => go('/addons')}>Add an addon</button>
                </div>
            )}
            {rows && rows.map(r => <RowView key={r.key} row={r} />)}
        </main>
    );
}
