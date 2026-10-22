const WebSocket = require('ws');
const [rooms, per, secs] = process.argv.slice(2).map(Number);
const PORT = +process.env.PORT || 3099;
const lat = []; let sentAt = new Map(); let closed = 0, joinedN = 0; const hosts = [];
const t0 = Date.now(); const joinTimes = [];
function client(room, idx) {
  const ws = new WebSocket(`ws://localhost:${PORT}/socket.io/?EIO=4&transport=websocket`, { headers: { Origin: `http://localhost:${PORT}` } });
  const started = Date.now();
  ws.on('message', m => {
    m = m.toString();
    if (m[0] === '0') ws.send('40');
    else if (m[0] === '2') ws.send('3');
    else if (m.startsWith('40')) ws.send(`42["join-room",{"roomId":"R${room}","username":"u${room}_${idx}"}]`);
    else if (m.includes('"joined"')) { joinedN++; joinTimes.push(Date.now() - started); if (idx === 0) hosts.push({ ws, room }); }
    else if (m.includes('video-playpause-sync')) { const j = JSON.parse(m.slice(m.indexOf('['))); const id = j[1].currentTime; const s = sentAt.get(id); if (s) lat.push(Date.now() - s); }
  });
  ws.on('close', () => closed++);
  ws.on('error', () => closed++);
  return ws;
}
(async () => {
  const total = rooms * per;
  for (let r = 0; r < rooms; r++) for (let i = 0; i < per; i++) { client(r, i); if ((r * per + i) % 50 === 49) await new Promise(r => setTimeout(r, 20)); }
  await new Promise(r => setTimeout(r, +(process.env.SETTLE||0) || 2500 + total * 3));
  console.log(`joined ${joinedN}/${total}; connect+join time ms p50 ${q(joinTimes, .5)} p95 ${q(joinTimes, .95)} max ${q(joinTimes, 1)}`);
  let ctr = 1;
  const end = Date.now() + secs * 1000;
  while (Date.now() < end) {
    for (const h of hosts) { const id = ctr++ * 10; sentAt.set(id, Date.now()); h.ws.send(`42["video-playpause",{"isPlaying":${ctr % 2 === 0},"currentTime":${id}}]`); }
    await new Promise(r => setTimeout(r, 1000));
  }
  await new Promise(r => setTimeout(r, 1500));
  console.log(`playpause deliveries ${lat.length}; latency ms p50 ${q(lat, .5)} p95 ${q(lat, .95)} p99 ${q(lat, .99)} max ${q(lat, 1)}; closed ${closed}`);
  process.exit(0);
})();
function q(a, p) { if (!a.length) return -1; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; }
