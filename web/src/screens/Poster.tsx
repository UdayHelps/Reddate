import React, { useContext } from 'react';
import { PickCtx } from '../pick';
import { Meta } from '../util';
import { useApp } from '../App';

export function PosterCard({ m, wide: wideIn, progress, onClick, label }: { m: Meta; wide?: boolean; progress?: number; onClick?: () => void; label?: string }) {
    // Videos with wide thumbnails (YouTube) show as wide cards, never cropped into a tall poster.
    const wide = wideIn || (m._raw && m._raw.posterShape === 'landscape');
    // A YouTube video (from Reddate YT): views bottom-left, length bottom-right, as on YouTube.
    const video = String(m.id).startsWith('yt:');
    // A YouTube channel: its round picture, with subscribers under the name.
    const channel = String(m.id).startsWith('ytc:');
    const { go, metaCache } = useApp();
    const pick = useContext(PickCtx);
    const href = `/title/${encodeURIComponent(m.type)}/${encodeURIComponent(m.id)}`;
    return (
        <a className={'poster' + (wide ? ' wide' : '') + (channel ? ' channel' : '')} href={href} onClick={e => {
            e.preventDefault();
            if (onClick) return onClick();
            if (pick) { metaCache.set(`${m.type}:${m.id}`, m); return pick(m); }
            metaCache.set(`${m.type}:${m.id}`, m);
            go(href);
        }}>
            <div className="img">
                {(wide ? m.background || m.poster : m.poster) ? <img loading="lazy" alt="" src={wide ? m.background || m.poster : m.poster} /> : null}
                {video && m.releaseInfo && <span className="badge l">{m.releaseInfo}</span>}
                {video && m.runtime && <span className="badge r">{m.runtime}</span>}
                {progress !== undefined && <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
            </div>
            <div className="t">{label || m.name}</div>
            {channel && m.releaseInfo && <div className="sub">{m.releaseInfo}</div>}
        </a>
    );
}
