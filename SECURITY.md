# Security

Reddate relays chat between people in a room, keeps optional accounts (email,
password hash, saved addons) and a password-protected stats page, so security
reports are welcome and taken seriously.

## Reporting a problem

Please **don't open a public issue** for a security problem. Use GitHub's
private reporting instead: on the repository page, go to
**Security → Report a vulnerability**.

Include what you found, how to reproduce it, and what an attacker could do.
This is a hobby project run by one person, so I can't promise a timeline, but
I'll acknowledge reports as soon as I can and credit you if you'd like.

## What's in scope

- Anything that breaks the privacy promises in the README's *What is and isn't
  private* table (for example chat or room contents being stored or logged, or
  addon URLs leaking outside a room).
- Account handling: sign-in, sessions, password reset, device pairing and the
  encrypted-at-rest storage.
- The `/stats` login, `/api/event`, `/media-info` (SSRF guards) and the
  Lounge signaling.
- Cross-site scripting or injection in the web app.

## Not in scope

- Anyone with a room's invite link can read that room. That's by design.
- Problems in third-party addons, GIPHY, OpenSubtitles or video hosts.
