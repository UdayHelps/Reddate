# How privacy works

Reddate is built to keep as little as possible:

1. **Rooms live in memory only.** A room is a random ID in the invite link
   (`.../#room=<id>`). When the last person leaves, the room, its chat and its
   addon list are gone. Nothing about a room is written to disk or a database.
2. **The server relays chat; it doesn't keep it.** Chat is not end-to-end
   encrypted, so the server can technically see messages while passing them on.
   It doesn't store or log them.
3. **Anyone with the invite link can join**, so treat the link like a password.
4. **Optional accounts** keep an email, a hash of your password, and your saved
   profiles and addons, encrypted at rest with a key held only by the server
   (so a leaked database alone exposes nothing, but whoever runs the server can
   read it). There's no recovery code: "Forgot password" works by email.

### What is and isn't private

| Data | Notes |
|------|-------|
| Chat text & images | Relayed by the server in plain form while passing between participants; **never stored or logged** |
| Voice/video (Lounge) | Peer-to-peer between participants, encrypted in transit by WebRTC; never touches the server |
| A room's addon list (and any tokens in addon URLs) | Visible to everyone in the room and to the server **while the room exists**; never stored |
| Which video is loaded / playback position | Relayed by the server (it coordinates sync), including a picked stream's URL and title |
| GIF searches | Sent from your browser straight to GIPHY |
| GIF images, direct video links, addon requests | Fetched from the external host, revealing your IP address to it |
| Account (optional): email, profiles, saved addons | Email stored for confirmation and reset mail. Password stored only as a salted hash. Saved profiles/addons are encrypted at rest with `VAULT_SECRET`, but readable by the server. Online status for "watch together" invites is held in memory only. |
| Usage stats (if enabled) | Anonymous counts only: visits, unique visitors per day (salted hash, salt rotated daily, never stored), rooms, joins, messages, videos started by type, feature use. No IPs, room links, chat, names or titles. |
| Stream files' audio languages | When the file host blocks the browser, the server reads the file's first 64 KB to list its languages, so it sees those candidate stream URLs |
