import { useEffect, useState } from 'react';
import { engine, Json } from './engine';

// The room's chat, kept by the app itself: it doesn't depend on a video being on screen, so lines that
// arrive in the lobby, during a reload or between videos are all there when you open Chat.
export interface ChatMsg { who: string; text: string; me: boolean; at: number }

let list: ChatMsg[] = [];
let room = '';
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());
const toMsg = (m: Json): ChatMsg => ({ who: m.self ? 'You' : String(m.user || 'Someone'), text: String(m.text || ''), me: !!m.self, at: Number(m.at) || Date.now() });

engine.on(ev => {
    if (ev.type !== 'chat-msg') return;
    const r = String(ev.room || '');
    if (r !== room) { room = r; list = []; }
    list = [...list.slice(-199), toMsg(ev)];
    notify();
});

export const chat = {
    list: () => list,
    on(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
    // What the room said before this screen opened.
    async load() {
        const r = await engine.call<Json[]>('chatHistory', {}, 8000).catch(() => null);
        if (!Array.isArray(r)) return;
        const seen = new Set(list.map(m => m.at + m.text));
        const older = r.map(toMsg).filter(m => !seen.has(m.at + m.text));
        if (older.length) { list = [...older, ...list].sort((a, b) => a.at - b.at).slice(-200); notify(); }
    },
    send: (text: string) => engine.call('sendChat', { text }, 8000),
    typing: (on: boolean) => engine.call('typing', { on }, 5000).catch(() => {})
};

export function useChat(): ChatMsg[] {
    const [l, setL] = useState(list);
    useEffect(() => { const off = chat.on(() => setL(chat.list())); chat.load(); setL(chat.list()); return off; }, []);
    return l;
}
