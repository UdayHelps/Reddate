// The engine: the existing Reddate page (rooms, sync, accounts, addons) running in a hidden frame. This app
// plays the part the Android TV app plays: it asks the engine things (rpc), hears from it (events) and is
// the player when the engine says "open this video". Same protocol as the TV's native bridge.
export type Json = any;

type Listener = (ev: Json) => void;
export interface PlayerHost {
    open(o: { url: string; sid: string; art: string; title: string; startMs: number; playWhenReady: boolean; subPref: string; chatOn: boolean }): void;
    command(c: Json): void;
}

class EngineClient {
    private frame: HTMLIFrameElement | null = null;
    private nextId = 1;
    private pending = new Map<number, { res: (v: Json) => void; rej: (e: Error) => void; t: number }>();
    private listeners = new Set<Listener>();
    private ready: Promise<void> | null = null;
    player: PlayerHost | null = null;
    /** Opens requested before a player screen exists. */
    pendingOpen: Parameters<PlayerHost['open']>[0] | null = null;
    onOpen: ((o: Parameters<PlayerHost['open']>[0]) => void) | null = null;
    private openListeners = new Set<(o: Parameters<PlayerHost['open']>[0]) => void>();
    onOpened(fn: (o: Parameters<PlayerHost['open']>[0]) => void) { this.openListeners.add(fn); return () => { this.openListeners.delete(fn); }; }
    private commandBacklog: Json[] = [];

    start(): Promise<void> {
        if (this.ready) return this.ready;
        const self = this;
        (window as any).ReddateHost = {
            nativeFor(_win: Window) {
                return {
                    deviceName: () => deviceName(),
                    exit: () => {},
                    hasPlayer: () => true,
                    hasYouTube: () => true,
                    hasNativeUi: () => true,
                    reply: (id: number, json: string) => self.onReply(id, json),
                    event: (json: string) => { try { self.emit(JSON.parse(json)); } catch { /* ignore */ } },
                    open: (json: string) => {
                        try {
                            const o = JSON.parse(json);
                            if (!/^https?:\/\//.test(o.url || '') && !(o.kind === 'yt' && o.videoId)) return;
                            (window as any).__opens = ((window as any).__opens || []).concat([o.sid + '@' + Date.now()]);
                            self.pendingOpen = o;
                            if (self.onOpen) self.onOpen(o);
                            self.openListeners.forEach(f => f(o));
                        } catch { /* ignore */ }
                    },
                    command: (json: string) => {
                        try {
                            const c = JSON.parse(json);
                            if (self.player) self.player.command(c); else self.commandBacklog.push(c);
                        } catch { /* ignore */ }
                    }
                };
            }
        };
        this.ready = new Promise<void>(resolve => {
            const f = document.createElement('iframe');
            f.src = '/engine?embed=1&tv=1';
            f.title = 'engine';
            f.setAttribute('aria-hidden', 'true');
            f.tabIndex = -1;
            f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1280px;height:720px;border:0;opacity:0;pointer-events:none';
            f.allow = 'autoplay';
            this.frame = f;
            document.body.appendChild(f);
            const t0 = Date.now();
            const poll = () => {
                const w = f.contentWindow as any;
                if (w && w.ReddateTV && typeof w.ReddateTV.rpc === 'function') return resolve();
                if (Date.now() - t0 > 30000) return resolve();
                setTimeout(poll, 80);
            };
            poll();
        });
        return this.ready;
    }

    private get win(): any { return this.frame && (this.frame.contentWindow as any); }

    call<T = Json>(method: string, args: Json = {}, timeoutMs = 30000): Promise<T> {
        return this.start().then(() => new Promise<T>((res, rej) => {
            const id = this.nextId++;
            const t = window.setTimeout(() => { this.pending.delete(id); rej(new Error('That took too long. Try again.')); }, timeoutMs);
            this.pending.set(id, { res: res as any, rej, t });
            try { this.win.ReddateTV.rpc(id, method, JSON.stringify(args)); }
            catch (e: any) { window.clearTimeout(t); this.pending.delete(id); rej(new Error(String(e && e.message || e))); }
        }));
    }

    private onReply(id: number, json: string) {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        window.clearTimeout(p.t);
        try {
            const o = JSON.parse(json);
            if (o.ok) p.res(o.r); else p.rej(new Error(o.error || 'Something went wrong'));
        } catch { p.rej(new Error('Bad answer')); }
    }

    /** Tell the engine something the player did (the same events the TV player sends). */
    send(ev: Json) {
        try { const w = this.win; if (w && w.ReddateTV && typeof w.ReddateTV.onNative === 'function') w.ReddateTV.onNative(ev); } catch { /* ignore */ }
    }

    /** The engine's event for the screens (surface changes, account, rows changed, play failures…). */
    on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
    private emit(ev: Json) { this.listeners.forEach(l => l(ev)); }

    attachPlayer(p: PlayerHost) {
        this.player = p;
        const backlog = this.commandBacklog; this.commandBacklog = [];
        backlog.forEach(c => p.command(c));
    }
    detachPlayer(p: PlayerHost) { if (this.player === p) this.player = null; }

    /** Raw DOM events from the engine's page (chat, vault changes…): the frame's document. */
    onDocumentEvent(name: string, fn: (d: Json) => void) {
        const attach = () => {
            const w = this.win;
            if (!w || !w.document) return;
            w.document.addEventListener(name, (e: any) => fn(e.detail));
        };
        this.start().then(attach);
    }
}

export function deviceName(): string {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    return `${browser}${os ? ' on ' + os : ''}`;
}

export const engine = new EngineClient();
