const WebSocket = require('ws');
const size = +process.argv[2];
function client(name, onMsg) {
  const ws = new WebSocket(`ws://localhost:${process.env.PORT||3099}/socket.io/?EIO=4&transport=websocket`, { headers: { Origin: `http://localhost:${process.env.PORT||3099}` } });
  ws.on('message', m => { m = m.toString(); if (m[0] === '0') ws.send('40'); else if (m[0] === '2') ws.send('3'); else onMsg(ws, m); });
  ws.on('close', (c, r) => console.log(name, 'closed', c, r.toString()));
  return ws;
}
let joined = 0, got = false;
const mk = (n) => client(n, (ws, m) => {
  if (m.startsWith('40')) ws.send(`42["join-room",{"roomId":"BIGTEST","username":"${n}"}]`);
  if (m.includes('"joined"')) { joined++; if (joined === 2 && n === 'b') setTimeout(() => { console.log('sending', size, 'bytes image'); ws.send(`42["send-message",{"t":"img","v":"data:image/png;base64,${'A'.repeat(size)}"}]`); }, 300); }
  if (m.includes('new-message')) { got = true; console.log(n, 'received message', m.length, 'bytes'); }
});
mk('a'); setTimeout(() => mk('b'), 200);
setTimeout(() => { console.log('delivered to other client:', got); process.exit(0); }, 5000);
