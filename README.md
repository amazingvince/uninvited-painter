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
game length (3/5/7 rounds or first to 10 points), 1–3 passes, **pen style**
(one unbroken line, or free ink with an explicit End Turn), an **ink budget**
per turn, an optional 60/90-second **stroke clock** so an idle player can't
stall the round, how **away players** are handled (pause the room for 30s, or
just wait for them), the rotating question master (or "auto word", where the
app draws it and everyone plays), and **Luna** — an AI critic who reviews the
finished picture, guesses the subject blind, and optionally names a suspect
(entertainment only; she never touches the score). The optional post-round AI exhibition adds a
selectable Witty, Savage, or Absurd Luna 5.6 critic, an optional non-scoring
AI detective vote, and a GPT Image 2 realistic rendition.

## Post-round AI exhibition

When either AI option is enabled, the app exports the finished drawing without
the word, player names, votes, scores, or fake identity and starts the work in
the background as soon as voting begins:

- **Luna 5.6** blindly invents a title, guesses the subject, rates the piece,
  reviews it, and can optionally name a suspect. Its suspect never affects
  voting or scoring.
- **GPT Image 2** automatically creates one believable real-world rendition,
  preserving the drawing's strange scale, placement, colors, overlaps, empty
  space, and apparent mistakes.

Both results stay hidden until the human outcome is public. The reveal runs
Luna's verdict → official attribution and scores → original/rendition pair →
standings. AI is ornamental: local and online play keep moving if OpenAI is
offline, slow, blocked, or unavailable.

Enabling the feature sends the finished drawing to OpenAI and uses API credits.
The OpenAI key remains server-side and must never use a `VITE_` prefix.

### Changing Luna's prompt

Run the evaluation first, and again afterwards:

```sh
npx vite-node scripts/critic-eval.mts              # 9 live calls, text only
npx vite-node scripts/critic-eval.mts --tone savage --repeat 3
```

It runs the real critic against three panels from a real finished game
(`scripts/fixtures/`) and reports the measurements that have actually caught
problems, rather than a sample to eyeball:

- **rating** should vary by *drawing* and not by *tone*. It once did the exact
  reverse — savage returned 5/10 on six of six pictures — which also meant
  "Luna's pick of the exhibition" was always round one.
- **confidence** should be higher on the legible panel than the murky two.
- **subject guess** must stay a short answer. When it drifted into describing
  the scene it stopped being comparable to the word at all: 0/9.
- **stock phrasing** counts known crutches and flags repeated rating tags.
  Banning a word does not remove the tic, it relocates it — "chaos" appeared
  in six of nine tags, and banning it produced "bold" in six of the next nine.
  Constrain the *shape* of the phrase instead, then re-run and check what new
  word moved in.

Every substantive problem with this feature was found this way and none of them
by reading the prompt, so it is worth the few cents.

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
- **Post-round AI**: a Cloudflare Workflow runs the independent Luna and GPT
  Image 2 calls in parallel. Private source/live artifacts use R2 `jobs/`
  keys; finished archive renditions are promoted to derived `archives/` keys.

## Develop

```sh
npm install
npm test               # engine test suite (vitest)
npm run build          # typecheck (app + worker) and vite build
npx wrangler dev       # serves the built app + worker + DO on :8787
npm run dev            # vite dev server with /api proxied to :8787
```

For local AI development, put `OPENAI_API_KEY` in the ignored `.env` file and
run through `npx wrangler dev`. Wrangler reads the key only in the Worker
environment. After changing bindings in `wrangler.jsonc`, regenerate types:

```sh
npm run types
```

Tip: append `?seat=2` to a room URL to hold a second seat from the same
browser (each seat gets its own identity token).

## Deploy

Create the private artwork bucket and production secret once:

```sh
npx wrangler r2 bucket create uninvited-painter-artwork
npx wrangler secret put OPENAI_API_KEY
```

Configure an R2 lifecycle rule that expires the temporary `jobs/` prefix after
one day while retaining `archives/` objects for the published archive lifetime.
The app deliberately avoids hard-coded image pricing; consult current OpenAI
pricing when estimating API usage.

```sh
npm run deploy         # build + wrangler deploy → painter.amazingvince.com
```

The custom domain is configured in `wrangler.jsonc` (`routes`). Change the
`pattern` there to move it.
