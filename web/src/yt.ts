// A YouTube video that looks like a <video> element to the player: the same properties and events,
// so one set of controls (and the same room sync) drives both. YouTube's own controls are hidden.

let apiP: Promise<any> | null = null;
function loadApi(): Promise<any> {
    const w = window as any;
    if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
    if (!apiP) {
        apiP = new Promise((res, rej) => {
            const prev = w.onYouTubeIframeAPIReady;
            w.onYouTubeIframeAPIReady = () => { try { if (prev) prev(); } catch { /* ignore */ } res(w.YT); };
            const s = document.createElement('script');
            s.src = 'https://www.youtube.com/iframe_api';
            s.async = true;
            s.onerror = () => { apiP = null; rej(new Error('YouTube could not be reached')); };
            document.head.appendChild(s);
        });
    }
    return apiP;
}

const UNSTARTED = -1, ENDED = 0, PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5;

export class YtVideo extends EventTarget {
    private api: any = null;
    private state = UNSTARTED;
    private wantVolume = 1;
    private wantMuted = false;
    private seekTo_: number | null = null;
    private seekUntil = 0;
    private dead = false;
    private startWanted = false;
    error: { code: number } | null = null;
    playbackRate = 1; // YouTube only offers a few fixed speeds: the room never needs them here
    readonly isYouTube = true;

    constructor(wrap: HTMLElement, private videoId: string) {
        super();
        const mount = document.createElement('div');
        wrap.appendChild(mount);
        loadApi().then(YT => {
            if (this.dead) return;
            this.api = new YT.Player(mount, {
                width: '100%', height: '100%', videoId: this.videoId,
                playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, origin: location.origin },
                events: {
                    onReady: () => {
                        if (this.dead) return;
                        try { this.api.setVolume(Math.round(this.wantVolume * 100)); if (this.wantMuted) this.api.mute(); } catch { /* ignore */ }
                        this.emit('loadedmetadata'); this.emit('canplay');
                        if (this.startWanted) this.api.playVideo();
                    },
                    onStateChange: (e: any) => {
                        const prev = this.state; this.state = e.data;
                        if (e.data === PLAYING) { if (prev !== PLAYING) this.emit('play'); this.emit('playing'); }
                        else if (e.data === PAUSED) this.emit('pause');
                        else if (e.data === BUFFERING) this.emit('waiting');
                        else if (e.data === ENDED) this.emit('ended');
                        else if (e.data === CUED) this.emit('canplay');
                    },
                    onError: (e: any) => { this.error = { code: Number(e && e.data) || 0 }; this.emit('error'); }
                }
            });
        }).catch(() => { this.error = { code: -1 }; this.emit('error'); });
    }

    private emit(t: string) { this.dispatchEvent(new Event(t)); }
    private ok() { return !!this.api && typeof this.api.getCurrentTime === 'function'; }

    get currentTime(): number {
        if (this.seekTo_ !== null && Date.now() < this.seekUntil) return this.seekTo_;
        return this.ok() ? Number(this.api.getCurrentTime()) || 0 : 0;
    }
    set currentTime(t: number) {
        if (!this.ok()) return;
        this.seekTo_ = t; this.seekUntil = Date.now() + 900;
        this.api.seekTo(t, true);
        window.setTimeout(() => { if (!this.dead) this.emit('seeked'); }, 300);
    }
    get duration(): number { return this.ok() ? Number(this.api.getDuration()) || 0 : 0; }
    get paused(): boolean { return this.state !== PLAYING && this.state !== BUFFERING; }
    get ended(): boolean { return this.state === ENDED; }
    get readyState(): number { return this.state === BUFFERING || this.state === UNSTARTED ? 2 : 4; }
    get buffered() {
        const end = this.ok() ? (Number(this.api.getVideoLoadedFraction()) || 0) * this.duration : 0;
        return { length: end > 0 ? 1 : 0, start: () => 0, end: () => end };
    }
    get volume() { return this.wantVolume; }
    set volume(x: number) { this.wantVolume = x; if (this.ok()) try { this.api.setVolume(Math.round(x * 100)); } catch { /* ignore */ } }
    get muted() { return this.wantMuted; }
    set muted(m: boolean) { this.wantMuted = m; if (this.ok()) try { m ? this.api.mute() : this.api.unMute(); } catch { /* ignore */ } }

    play(): Promise<void> {
        this.startWanted = true;
        if (!this.ok()) return Promise.resolve();
        this.api.playVideo();
        // Browsers refuse to start a video nobody tapped: say so after a moment so the player asks for a tap.
        return new Promise((res, rej) => window.setTimeout(() => (this.state === PLAYING || this.state === BUFFERING ? res() : rej(new Error('blocked'))), 1800));
    }
    pause() { this.startWanted = false; if (this.ok()) this.api.pauseVideo(); }

    // The bits of <video> the player touches that mean nothing here.
    set src(_v: string) { /* the video id is fixed */ }
    load() { /* nothing */ }
    removeAttribute(_n: string) { /* nothing */ }
    canPlayType() { return ''; }

    destroy() {
        this.dead = true;
        try { if (this.api && this.api.destroy) this.api.destroy(); } catch { /* ignore */ }
        this.api = null;
    }
}
