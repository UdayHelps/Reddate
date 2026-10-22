const WebSocket = require('ws');
const host = process.argv[2] || 'tv.reddate.xyz';
const t0 = Date.now();
const ws = new WebSocket(`wss://${host}/socket.io/?EIO=4&transport=websocket`, { headers: { Origin: `https://${host}` } });
let n = 0, ids = 0; const rtts = [], offs = []; const pend = new Map(); let opened = 0;
ws.on('open', () => { opened = Date.now() - t0; });
ws.on('message', m => {
  m = m.toString();
  if (m[0] === '0') { console.log('handshake after', Date.now() - t0, 'ms (ws open', opened, 'ms)'); ws.send('40'); }
  else if (m[0] === '2') ws.send('3');
  else if (m.startsWith('40')) { console.log('namespace connected after', Date.now() - t0, 'ms'); next(); }
  else if (m.startsWith('43')) {
    const id = parseInt(m.slice(2)); const s = pend.get(id); const t1 = Date.now();
    const st = JSON.parse(m.slice(m.indexOf('[')))[0];
    rtts.push(t1 - s); offs.push(st - (s + t1) / 2); pend.delete(id);
    if (rtts.length < 30) setTimeout(next, 150); else done();
  }
});
function next() { const id = ++ids; pend.set(id, Date.now()); ws.send(`42${id}["time",{}]`); }
function done() {
  const s = [...rtts].sort((a, b) => a - b), q = p => s[Math.floor(p * (s.length - 1))];
  console.log('time-ack RTT ms  min', s[0], 'p50', q(.5), 'p90', q(.9), 'max', s[s.length - 1]);
  const o = [...offs].sort((a, b) => a - b);
  console.log('clock offset spread ms', Math.round(o[o.length - 1] - o[0]), '(min-RTT sample offset', Math.round(offs[rtts.indexOf(s[0])]), ')');
  ws.close(); process.exit(0);
}
setTimeout(() => { console.log('timeout'); process.exit(1); }, 40000);
