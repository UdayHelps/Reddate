# Performance probes

Plain Node scripts (they only need the `ws` package that is already in node_modules). Run from the repo root.

- `node docs/perf/rtt.js [host]` — opens a WebSocket to the live server and times 30 `time` round trips (the same
  call the app uses for its clock) plus the connect time. Shows the real ping and how steady the clock offset is.
- `PORT=3099 node docs/perf/load.js <rooms> <people per room> <seconds>` — starts a local server first
  (`PORT=3099 MAIL_MODE=log node server.js`), joins everyone, then play/pauses once a second from each room's first
  person and reports join time and delivery latency. `SETTLE=35000` waits for the joins to finish before measuring.
- `PORT=3099 node docs/perf/bigmsg.js <bytes>` — sends a chat image of that size; shows whether the connection survives.
