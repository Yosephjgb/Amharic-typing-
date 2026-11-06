# Fidel Race — Amharic typing

A phonetic Amharic (Fidel) typing site: type the sound, get the letter (`he` → ሀ, `ha` → ሃ, `se` → ሰ, `selam` → ሰላም).

## Pages (top bar)

| Tab | What it is |
|---|---|
| **Speed test** (home) | Normal timed typing test (30s / 60s / 2 min) with an explanation on top. Shows WPM, accuracy, words and Fidel letters. |
| **Practice** | **All the letters** (all 203, pick one family or all; letters you miss come back more often) and **Words** (45 everyday words with English meanings). No timer. |
| **Multiplayer** | **Race bots**, **PvP quick match** (next real player on the same level), or a **private room** (create + share a 4-letter code, or join one). Up to 4 players. |
| **Sign in** (top right) | Optional. An account saves speed-test history, practice progress and online record, and syncs across devices. Everything works without one. |

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000 (two tabs to race yourself).

- **Same Wi-Fi:** friends open `http://YOUR-LOCAL-IP:3000`.
- **Anywhere:** deploy to any Node host that supports WebSockets (Render, Railway, Fly.io, a VPS). The server reads `PORT`.
  Behind HTTPS the page automatically uses `wss://`.
- Opening `public/index.html` straight from disk works for the speed test, practice and bots only. Online play and accounts need the server.

## Accounts (optional)

- Username (3–20 letters/numbers/`._-`) + password (6+ characters). No email, so **there is no password reset yet**.
- Passwords are hashed with scrypt, never stored in plain text. Sessions last 30 days. Sign-in attempts are rate-limited per IP.
- Data is stored in `data/users.json` (change the folder with the `DATA_DIR` environment variable). **On hosts with a temporary
  disk (many free tiers) this file is wiped on redeploy. Mount a persistent disk, or move to a database.**
- Signing in merges what's on the device with the account, so nothing is lost. Signing out clears the device (the data stays in the account).
- Signed-in players always race under their account name. A guest who types a registered name is shown as `Name (guest)`.

## Files

| File | Purpose |
|---|---|
| `server.js` | HTTP + WebSocket server: accounts API, rooms, matchmaking, referee |
| `public/core.js` | Phonetic engine, words, letters and levels, shared by server and browser |
| `public/index.html` | The whole site (all pages) |

## How online races stay fair (basic)

The server owns the clock and picks the items. A client only reports how far it got, and the server caps that at
14 keystrokes/second (about 168 WPM), so claiming an instant finish does nothing. This stops casual cheating, not a
determined bot.

## Known limits

- Rooms and queues live in memory: restarting the server clears them.
- Saved stats are reported by the browser, so they are not tamper-proof. A public leaderboard would need server-side checks.
- The word list and sentences were written without a native-speaker review. Please have an Amharic speaker check them
  (`VOCAB` and `LONG_SENTENCES` in `public/core.js`).
- Letters that need special keys (ሐ ሠ ዐ ኀ and the labialized forms like ቈ ጓ) can't be typed yet.
