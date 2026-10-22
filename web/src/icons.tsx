import React from 'react';
const P = (d: string) => (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d={d} /></svg>
);
export const IHome = P('M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3z');
export const ISearch = P('M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm10 2-4.3-4.3');
export const IUsers = P('M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8');
export const IPlay = P('M6 4l14 8-14 8z');
export const IPause = P('M7 4v16M17 4v16');
export const IAdd = P('M12 5v14M5 12h14');
export const IX = P('M18 6 6 18M6 6l12 12');
export const IChat = P('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
export const ISub = P('M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 13h4M13 13h4M7 16h2M12 16h5');
export const IAudio = P('M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13');
export const IShare = P('M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14');
export const IFull = P('M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3');
export const IUser = P('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z');
export const IList = P('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01');
export const IBack = P('M15 18l-6-6 6-6');
export const IVolume = P('M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13');
export const IMute = P('M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6');
export const ISwap = P('M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3');
export const ICrown = P('M2 18l3-11 5 5 2-8 2 8 5-5 3 11zM3 21h18');

// The Reddate mark (two overlapping screens) and the wordmark beside it.
export function Mark({ size = 30 }: { size?: number }) {
    return (
        <svg viewBox="22 24 64 56" width={size} height={size * 56 / 64} aria-hidden="true">
            <defs><clipPath id="rd-mark-b"><rect x="22" y="24" width="52" height="36" rx="8" /></clipPath></defs>
            <rect x="22" y="24" width="52" height="36" rx="8" fill="#ff7a3c" />
            <rect x="34" y="44" width="52" height="36" rx="8" fill="#f6f1ea" />
            <rect x="34" y="44" width="52" height="36" rx="8" fill="#ff3b1f" clipPath="url(#rd-mark-b)" />
        </svg>
    );
}
export function Wordmark({ size = 30 }: { size?: number }) {
    return <span className="wm"><Mark size={size} /><span>Reddate</span></span>;
}
