/* Voice room, Discord-style: anyone in the room can join or leave at any time,
 * up to 8 people. Mic on by default, camera optional.
 *
 * Every member connects directly to every other member (a WebRTC mesh), so
 * audio and video travel peer-to-peer and are end-to-end encrypted by WebRTC
 * itself (DTLS-SRTP). The server only relays connection setup between people
 * in the same voice room. A TURN relay, if configured, forwards encrypted
 * packets it cannot read.
 *
 * Connections use the "perfect negotiation" pattern, so either side can add a
 * camera later without the two ends tripping over each other. initVoice() is
 * called from app.js once the socket connects.
 */
window.initVoice = function (socket, toast) {
    const cfgPromise = fetch('/rtc-config').then(r => r.json())
        .catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }));

    const $ = id => document.getElementById(id);
    const panel = $('voicePanel');
    const grid = $('voiceGrid');
    const audioBox = $('voiceAudio');
    const voiceBtn = $('callBtn');

    let inVoice = false;
    let joining = false;
    let localStream = null;
    let micOn = true;
    let camOn = false;
    let members = [];          // [{ id, username, muted, cam }] from the server
    const peers = new Map();   // id -> { pc, polite, makingOffer, ignoreOffer, senders, stream }
    const queues = new Map();  // id -> promise chain, so one peer's signals run in order
    let audioCtx = null;
    const meters = new Map();  // id -> { analyser, data }
    let meterTimer = null;

    // ---------- peer connections ----------
    function signal(to, payload) { socket.emit('voice-signal', { to, signal: payload }); }

    function addLocalTracks(peer) {
        localStream.getTracks().forEach(t => {
            if (!peer.senders.has(t.kind)) peer.senders.set(t.kind, peer.pc.addTrack(t, localStream));
        });
        peer.tracksAdded = true;
    }

    async function createPeer(id, initiator) {
        const { iceServers } = await cfgPromise;
        const pc = new RTCPeerConnection({ iceServers });
        const peer = {
            pc, polite: socket.id > id, makingOffer: false, ignoreOffer: false,
            senders: new Map(), stream: null, tracksAdded: false
        };
        peers.set(id, peer);
        pc.onicecandidate = e => { if (e.candidate) signal(id, { candidate: e.candidate }); };
        pc.onnegotiationneeded = async () => {
            try {
                peer.makingOffer = true;
                await pc.setLocalDescription();
                signal(id, { sdp: pc.localDescription });
            } catch (_) { /* superseded by the other side's offer */ } finally {
                peer.makingOffer = false;
            }
        };
        pc.ontrack = e => {
            peer.stream = e.streams[0] || peer.stream || new MediaStream();
            if (!e.streams[0]) peer.stream.addTrack(e.track);
            attachRemote(id, peer.stream);
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') pc.restartIce();
        };
        if (initiator) addLocalTracks(peer);
        return peer;
    }

    async function handleSignal(from, data) {
        let peer = peers.get(from);
        if (!peer) peer = await createPeer(from, false);
        const { pc } = peer;
        if (data.sdp) {
            const desc = data.sdp;
            const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
            peer.ignoreOffer = !peer.polite && collision;
            if (peer.ignoreOffer) return;
            await pc.setRemoteDescription(desc); // the polite side rolls back its own offer
            if (desc.type === 'offer') {
                if (!peer.tracksAdded) addLocalTracks(peer); // reuses the offered transceivers
                await pc.setLocalDescription();
                signal(from, { sdp: pc.localDescription });
            }
        } else if (data.candidate) {
            try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) console.warn(e); }
        }
    }

    function closePeer(id) {
        const peer = peers.get(id);
        if (peer) { peer.pc.close(); peers.delete(id); }
        queues.delete(id);
        meters.delete(id);
        audioBox.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
    }

    // ---------- audio out + speaking indicator ----------
    function attachRemote(id, stream) {
        let audio = audioBox.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.autoplay = true;
            audio.dataset.id = id;
            audioBox.appendChild(audio);
        }
        if (audio.srcObject !== stream) audio.srcObject = stream;
        audio.play().catch(() => {});
        watchLevel(id, stream);
        renderTiles();
    }

    function watchLevel(id, stream) {
        const track = stream.getAudioTracks()[0];
        if (!audioCtx || !track || meters.get(id)?.track === track) return;
        try {
            const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            meters.set(id, { track, analyser, data: new Uint8Array(analyser.fftSize) });
        } catch (_) { /* level meter is a nice-to-have */ }
    }

    function pollLevels() {
        for (const [id, m] of meters) {
            m.analyser.getByteTimeDomainData(m.data);
            let sum = 0;
            for (const v of m.data) { const x = (v - 128) / 128; sum += x * x; }
            const speaking = Math.sqrt(sum / m.data.length) > 0.03 && !(id === socket.id && !micOn);
            grid.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.toggle('speaking', speaking);
        }
    }

    // ---------- UI ----------
    function renderTiles() {
        const seen = new Set();
        members.forEach(m => {
            seen.add(m.id);
            const me = m.id === socket.id;
            let tile = grid.querySelector(`[data-id="${CSS.escape(m.id)}"]`);
            if (!tile) {
                tile = document.createElement('div');
                tile.className = 'voice-tile';
                tile.dataset.id = m.id;
                tile.innerHTML = '<video autoplay playsinline muted></video><span class="voice-avatar"></span>' +
                    '<span class="voice-name"><span class="n"></span>' +
                    '<svg class="icon voice-muted" aria-label="Muted"><use href="#i-mic-off"/></svg></span>';
                grid.appendChild(tile);
            }
            const name = m.username || 'Guest';
            tile.querySelector('.voice-avatar').textContent = name.trim().charAt(0).toUpperCase() || '?';
            tile.querySelector('.n').textContent = me ? `${name} (you)` : name;
            tile.classList.toggle('is-muted', me ? !micOn : m.muted);
            tile.classList.toggle('me', me);
            const cam = me ? camOn : m.cam;
            const video = tile.querySelector('video');
            const stream = me ? localStream : peers.get(m.id)?.stream;
            const hasVideo = cam && stream && stream.getVideoTracks().some(t => t.readyState === 'live');
            tile.classList.toggle('has-video', !!hasVideo);
            if (hasVideo && video.srcObject !== stream) { video.srcObject = stream; video.play().catch(() => {}); }
            if (!hasVideo && video.srcObject) video.srcObject = null;
        });
        grid.querySelectorAll('.voice-tile').forEach(t => { if (!seen.has(t.dataset.id)) t.remove(); });
        $('voiceCount').textContent = String(members.length);
    }

    function updateButton() {
        const others = members.filter(m => m.id !== socket.id).length;
        const label = voiceBtn.querySelector('.label');
        label.textContent = inVoice ? 'In the lounge' : others ? `Lounge · ${others}` : 'Lounge';
        voiceBtn.classList.toggle('is-on', inVoice);
        voiceBtn.classList.toggle('has-people', !inVoice && others > 0);
        voiceBtn.setAttribute('aria-label', inVoice ? 'Lounge voice room (you’re in it)'
            : others ? `Join the lounge — ${others} ${others === 1 ? 'person' : 'people'} talking` : 'Join the lounge voice room');
    }

    function updateControls() {
        $('micBtn').classList.toggle('off', !micOn);
        $('micBtn').querySelector('use').setAttribute('href', micOn ? '#i-mic' : '#i-mic-off');
        $('micBtn').setAttribute('aria-label', micOn ? 'Mute microphone' : 'Unmute microphone');
        $('camBtn').classList.toggle('off', !camOn);
        $('camBtn').querySelector('use').setAttribute('href', camOn ? '#i-video' : '#i-video-off');
        $('camBtn').setAttribute('aria-label', camOn ? 'Turn camera off' : 'Turn camera on');
    }

    function sendState() { socket.emit('voice-state', { muted: !micOn, cam: camOn }); }

    // ---------- join / leave ----------
    async function join() {
        if (inVoice || joining) return;
        joining = true;
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
        } catch (_) {
            joining = false;
            toast('Microphone permission is needed to join the lounge');
            return;
        }
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) { audioCtx = new Ctx(); audioCtx.resume().catch(() => {}); }
        } catch (_) { audioCtx = null; }
        micOn = true;
        camOn = false;
        socket.emit('voice-join');
    }

    function leave(notify = true) {
        if (!inVoice && !joining) return;
        if (notify) socket.emit('voice-leave');
        [...peers.keys()].forEach(closePeer);
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        clearInterval(meterTimer);
        meters.clear();
        if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
        inVoice = false;
        joining = false;
        camOn = false;
        panel.classList.remove('show');
        grid.innerHTML = '';
        members = members.filter(m => m.id !== socket.id);
        updateButton();
    }

    async function toggleCam() {
        if (!inVoice) return;
        if (!camOn) {
            let track;
            try {
                const s = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
                });
                track = s.getVideoTracks()[0];
            } catch (_) { toast('Camera permission needed'); return; }
            localStream.addTrack(track);
            peers.forEach(peer => {
                const sender = peer.senders.get('video');
                if (sender) sender.replaceTrack(track);
                else peer.senders.set('video', peer.pc.addTrack(track, localStream)); // renegotiates
            });
            camOn = true;
        } else {
            localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
            peers.forEach(peer => peer.senders.get('video')?.replaceTrack(null)); // camera light off, no renegotiation
            camOn = false;
        }
        updateControls();
        sendState();
        renderTiles();
    }

    // ---------- socket events ----------
    socket.on('voice-joined', async ({ peers: existing = [] }) => {
        if (!joining) { socket.emit('voice-leave'); return; } // left while joining
        joining = false;
        inVoice = true;
        panel.classList.add('show');
        panel.classList.remove('collapsed');
        restorePanel();
        watchLevel(socket.id, localStream);
        meterTimer = setInterval(pollLevels, 150);
        updateControls();
        updateButton();
        // The newcomer calls everyone already there.
        for (const id of existing) { if (!peers.has(id)) await createPeer(id, true); }
    });

    socket.on('voice-full', ({ max }) => {
        toast(`The lounge is full (${max} people max)`);
        leave(false);
    });

    socket.on('voice-members', list => {
        members = Array.isArray(list) ? list : [];
        const ids = new Set(members.map(m => m.id));
        [...peers.keys()].forEach(id => { if (!ids.has(id)) closePeer(id); });
        if (inVoice && !ids.has(socket.id)) { leave(false); return; }
        if (inVoice) renderTiles();
        updateButton();
    });

    socket.on('voice-signal', ({ from, signal: data }) => {
        if (!inVoice || !from || !data) return;
        // Run one peer's signals in order (an answer must land before its candidates).
        const run = () => handleSignal(from, data).catch(e => console.warn('voice:', e));
        queues.set(from, (queues.get(from) || Promise.resolve()).then(run));
    });

    // A dropped connection loses the server-side seat; tidy up locally.
    socket.on('disconnect', () => {
        if (inVoice || joining) { toast('Dropped from the lounge — tap Lounge to rejoin'); leave(false); }
        members = [];
        updateButton();
    });

    // ---------- controls ----------
    voiceBtn.addEventListener('click', () => {
        if (!inVoice) { join(); return; }
        panel.classList.remove('collapsed'); // already in: just reveal the panel
        $('voiceCollapse').setAttribute('aria-expanded', 'true');
    });
    $('hangupBtn').addEventListener('click', () => leave(true));
    $('micBtn').addEventListener('click', () => {
        micOn = !micOn;
        if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = micOn; });
        updateControls();
        sendState();
        renderTiles();
    });
    $('camBtn').addEventListener('click', toggleCam);
    $('voiceCollapse').addEventListener('click', () => {
        const collapsed = panel.classList.toggle('collapsed');
        $('voiceCollapse').setAttribute('aria-expanded', String(!collapsed));
    });
    window.addEventListener('pagehide', () => { if (inVoice) socket.emit('voice-leave'); });
    wireDrag();
    updateButton();

    // ---------- drag the panel anywhere, like picture-in-picture ----------
    // Grab the header; the spot is remembered (as a share of the screen, so it
    // survives rotation) and kept fully on screen.
    function placePanel(x, y) {
        const m = 8, w = panel.offsetWidth, h = panel.offsetHeight;
        x = Math.min(Math.max(m, x), window.innerWidth - w - m);
        y = Math.min(Math.max(m, y), window.innerHeight - h - m);
        Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
        return { x, y };
    }

    function restorePanel() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem('reddate-voice-pos')); } catch (_) {}
        if (!saved || !panel.classList.contains('show')) return;
        placePanel(saved.fx * window.innerWidth, saved.fy * window.innerHeight);
    }

    function wireDrag() {
        const head = panel.querySelector('.voice-head');
        let start = null;
        head.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.target.closest('button')) return;
            const rect = panel.getBoundingClientRect();
            start = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, id: e.pointerId };
            head.setPointerCapture(e.pointerId);
            panel.classList.add('dragging');
        });
        head.addEventListener('pointermove', e => {
            if (!start || e.pointerId !== start.id) return;
            placePanel(e.clientX - start.dx, e.clientY - start.dy);
        });
        const end = e => {
            if (!start || e.pointerId !== start.id) return;
            start = null;
            panel.classList.remove('dragging');
            const rect = panel.getBoundingClientRect();
            try {
                localStorage.setItem('reddate-voice-pos', JSON.stringify({
                    fx: rect.left / window.innerWidth, fy: rect.top / window.innerHeight
                }));
            } catch (_) {}
        };
        head.addEventListener('pointerup', end);
        head.addEventListener('pointercancel', end);
        // Keep it on screen when the window resizes or the panel grows/shrinks.
        const keepOnScreen = () => {
            if (panel.style.top) { const r = panel.getBoundingClientRect(); placePanel(r.left, r.top); }
        };
        window.addEventListener('resize', keepOnScreen);
        new ResizeObserver(keepOnScreen).observe(panel);
    }
};
