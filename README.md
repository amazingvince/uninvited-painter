# The Uninvited Painter

A mobile web clone of *A Fake Artist Goes to New York*, live at
**https://painter.amazingvince.com**.

Everyone gets one stroke. Two passes. One player was never told what the
picture is.

Two modes:

- **Pass one phone** — local play, the phone travels around the table (works
  fully offline once installed — the app is a PWA).
- **Play online** — room code, link and a lobby QR code; every phone draws on
  the same canvas. A **spectator link** (`/w/CODE`) lets extras watch the wall
  without a seat, and a finished game can be **published to a permanent
  gallery page** (`/a/:id`) with link previews.

Options per room: deck (four built-ins, "everything", or a **house deck** the
players write themselves — the fake artist is never dealt a word they wrote),
game length (3/5/7 rounds or first to 10 points), 1–3 passes, an optional
60/90-second **stroke clock** so an idle player can't stall the round, and the
rotating question master.

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
  "everything" and the per-room house deck. No word repeats within a session.
- **Archives** (`worker/archives.ts`): published games live in Workers KV for
  a year behind strictly-validated, unauthenticated endpoints; `worker/og.ts`
  injects link-preview meta into the SPA shell with HTMLRewriter.

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
