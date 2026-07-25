# The Uninvited Painter

A mobile web clone of *A Fake Artist Goes to New York*, live at
**https://painter.amazingvince.com**.

Everyone gets one stroke. Two passes. One player was never told what the
picture is.

Two modes:

- **Pass one phone** — local play, the phone travels around the table.
- **Play online** — room code + link, every phone draws on the same canvas.

## Architecture

- **Cloudflare Worker** serves the static app (Vite/React build in `dist/`)
  and routes `/api/*`.
- **One Durable Object per room** (`worker/room.ts`), keyed by the 4-letter
  code: holds the authoritative state and the WebSocket set (hibernation API),
  runs alarms for the 30s guess timer, 30s disconnect seat-holds and the
  15-minute empty-room TTL.
- **Shared engine** (`shared/engine.ts`): one deterministic reducer runs the
  whole round state machine (`lobby → dealing → drawing → voting → guessing →
  reveal → closed`) in both modes — in memory for local play, inside the DO
  for online play.
- **Anti-cheat**: the word only ever goes to real artists' (and the QM's)
  sockets, ballots stay sealed server-side until everyone has locked in, turn
  order and guess matching are enforced in the DO — the client never decides
  (`shared/protocol.ts` → `redactState`).
- **Decks** (`shared/decks/*.json`): animals, food, movies, objects — plus
  "everything". No word repeats within a session.

## Develop

```sh
npm install
npm test               # engine test suite (vitest)
npm run build          # typecheck (app + worker) and vite build
npx wrangler dev       # serves the built app + worker + DO on :8787
npm run dev            # vite dev server with /api proxied to :8787
```

Tip: append `?seat=2` to a room URL to hold a second seat from the same
browser (each seat gets its own identity token).

## Deploy

```sh
npm run deploy         # build + wrangler deploy → painter.amazingvince.com
```

The custom domain is configured in `wrangler.jsonc` (`routes`). Change the
`pattern` there to move it.
