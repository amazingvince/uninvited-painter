# AI Critic and Detective

Date: 2026-07-25

## Summary

Add an optional OpenAI-powered gallery critic to The Uninvited Painter. After
the human ballots close, the model examines the finished drawing without being
told the real word, fake artist, votes, or outcome. It can:

- invent a title for the piece;
- guess what the group drew;
- rate and briefly review the artwork;
- make one artwork-focused comment about a named player's visible stroke; and
- optionally make a separate, non-scoring fake-artist pick.

The official game remains entirely human-decided. AI never casts a counted
ballot, changes scores, supplies the fake artist's guess, or blocks a round.
The same feature is available in online rooms and pass-one-phone games when
the device has a network connection. Core local play remains fully offline.

## Product Decisions

### Settings

Add three settings:

- `aiCritic: boolean`: show the title, subject guess, rating, review, and
  optional player-stroke callout.
- `aiDetective: boolean`: show a non-scoring suspect pick and reason.
- `aiTone: "witty" | "savage" | "absurd"`: control the voice whenever either
  AI feature is enabled.

Defaults for a new or normalized game:

- AI critic: on
- AI detective: off
- Tone: witty

The critic and detective are independent. A group may enable either or both.
The tone control is shown when at least one feature is on.

Tone definitions:

- **Witty:** dry museum-curator shade.
- **Savage:** sharper and more direct, while attacking only the artwork and
  choices visible on the canvas.
- **Absurd:** surreal art-world nonsense delivered with complete confidence.

All tones prohibit insults about identity, appearance, intelligence,
disability, personal worth, or other off-canvas traits. The player-specific
line is limited to one light jab per round and must discuss that player's
visible color or stroke. The model may omit it when there is not enough visual
evidence.

### Round sequence

Human voting and scoring keep their existing rules and sequence:

1. Human artists submit sealed ballots.
2. The last ballot closes voting and starts one blind AI analysis in the
   background when either AI feature is enabled.
3. The human tally appears.
4. If the fake artist was accused, their normal timed word guess happens.
5. Once the outcome is settled, the new **Critic's Verdict** screen appears.
6. The existing official attribution reveal follows.
7. Standings follow the reveal.

The model result is never visible before step 5. This prevents the AI's subject
guess from hinting at the word during the fake artist's own guess.

The Critic's Verdict screen contains only the enabled sections:

- invented artwork title;
- blind subject guess;
- integer rating from 1 through 10 and a short rating tag;
- a review of no more than two short sentences;
- an optional named-player stroke callout;
- an optional non-scoring suspect and one-sentence reason.

The official reveal derives two compact comparison payoffs without another
model call:

- whether the critic's subject guess matches the real word using the game's
  existing fuzzy matcher; and
- whether the detective selected the actual fake artist.

Confidently wrong answers are treated as part of the entertainment.

### Waiting and failure behavior

The analysis begins behind the tally and fake-guess flow, which will often hide
its latency. If it is still pending when the critic screen is reached, the host
may wait or choose **Proceed without dignity**. Skipping an online verdict is
host-only and is broadcast to the room; the active pass-one-phone device owns
the equivalent local action.

Skipping is final for that round. A response that arrives after a skip, after a
new round begins, or for a stale request identifier is discarded.

AI failure never prevents scoring, attribution, standings, starting the next
round, closing the game, saving an image, or publishing an archive. Failure
states use short in-world copy, for example:

- Offline: "No connection, no opinion. Refreshing."
- Provider or validation failure: "The critic has declined to defend its
  opinion."

Online non-host players wait for the shared result or the host's shared skip.
When both AI features are off, the critic step is omitted entirely.

## Data Model

Add these shared types:

```ts
type AiTone = "witty" | "savage" | "absurd";
type CriticStatus =
  | "idle"
  | "pending"
  | "ready"
  | "skipped"
  | "unavailable";

interface CriticVerdict {
  requestId: string;
  title?: string;
  subjectGuess?: string;
  rating?: number;
  ratingTag?: string;
  review?: string;
  callout?: {
    playerId: string;
    text: string;
  };
  detective?: {
    playerId: string;
    reason: string;
  };
}

interface RoundCritic {
  status: CriticStatus;
  requestId: string | null;
  verdict: CriticVerdict | null;
}
```

`RoundState` gets a `critic` field initialized to `idle`. The reducer receives
explicit events for requesting, resolving, skipping, and making the critic
unavailable. The nondeterministic response is carried inside an event so the
shared reducer itself stays deterministic.

Only enabled sections are stored. `rating` must be an integer from 1 through
10. All output strings have server-enforced length limits. Returned player IDs
must refer to an eligible, non-dropped artist in the current round. The
detective can never select the question master.

`ArchiveEntry` accepts an optional sanitized verdict so old archives and old
saved local games remain valid. `normalizeRoom` supplies the new setting and
round defaults for persisted states created before this feature.

## Image Input

Reuse the existing client-side vector drawing renderer. Extract a critic export
that produces a 512 by 512 PNG with the same paper, colors, rounded lines, and
stroke order players see. Unlike the current save/share image, the critic image
contains no caption or real word.

The browser uploads only:

- the PNG;
- the room and round identifiers needed to reject stale work; and
- authentication needed by an online room.

For online rooms, the Durable Object obtains the authoritative player list,
eligible artists, color legend, settings, and round state. It does not trust
client-supplied candidates or tone. For local mode, the generic endpoint
strictly validates the small player/color legend and setting enums supplied by
the local client. The response cannot affect official gameplay.

The image is held only for the provider request. It is not logged, archived, or
stored by the game service.

## OpenAI Integration

`OPENAI_API_KEY` is read only in the Cloudflare Worker environment. The
existing ignored `.env` supplies it to local Wrangler development. Production
uses a Wrangler secret with the same name. The key must not use a `VITE_`
prefix, enter client state, or be included in a browser request or bundle.

Use the OpenAI Responses API with:

- a vision-capable `gpt-5.6-luna` default;
- an optional server-only `OPENAI_CRITIC_MODEL` override;
- `reasoning.effort` set to `low` for the latency-sensitive reveal;
- the 512 by 512 PNG at low image detail;
- a fixed developer instruction selected by `aiTone`;
- a data block containing stable player IDs, display names, and colors;
- strict structured output for the verdict shape; and
- a small output-token limit appropriate for the bounded copy.

The prompt explicitly says the model is blind to the intended word and must
describe only what is visible. Player names and colors are delimited as data,
not instructions. House-deck words, the real word, fake identity, votes,
scores, and outcome are never included.

If `aiCritic` is on, title, subject guess, rating, rating tag, and review are
required; the player callout remains optional. If `aiCritic` is off, all critic
fields are omitted. If `aiDetective` is on, a valid eligible-player pick and
reason are required; if it is off, both detective fields are omitted. When only
detective mode is enabled, the card shows only its pick and reason.

The server validates and normalizes the parsed response again even though the
provider uses strict structured output. Invalid optional fields are dropped.
An invalid required section, HTTP error, timeout, or unparseable response marks
the request unavailable.

## Online Data Flow

Add an authenticated critic request route for a room. A joined browser supplies
its private room token and the rendered PNG after voting has closed. The room
Durable Object verifies:

- the token still maps to a seated player;
- the room and round are current;
- human voting has closed;
- at least one AI feature is enabled;
- the critic status is `idle`; and
- the PNG meets the declared size and format limits.

The first valid request atomically changes the round to `pending` and assigns a
request ID before starting external work. Later requests for that round observe
the existing status and cannot create another provider call. The Durable
Object runs the provider request as background work, then re-reads the room and
accepts the result only if the round number, request ID, and `pending` status
still match. It persists and broadcasts the final state.

Protocol redaction may expose `pending`, `skipped`, or `unavailable`, but it
must omit a ready verdict until the round outcome is non-null. Spectators and
players receive the same verdict after that boundary.

## Local Data Flow

Pass-one-phone mode watches for the transition out of voting, renders the same
wordless PNG, and calls a generic Worker critic endpoint. It dispatches
request, result, skip, or unavailable events into the shared reducer and saves
the updated local state.

The request uses the current round number and request ID. A response is applied
only when both still match. A missing connection fails quickly into
`unavailable`; the PWA does not retry in a loop or require connectivity to
continue.

Because the public local endpoint has no room membership boundary, it receives
additional cost controls described below.

## Cost, Abuse, and Privacy Controls

- The game client initiates no more than one request per local round and never
  retries automatically. The online Durable Object additionally enforces one
  provider call per round under concurrent requests.
- A Cloudflare rate-limiter binding on critic request routes, keyed by client
  IP, capped at 10 accepted requests per 60 seconds.
- Exact `Content-Length` enforcement before buffering.
- Maximum PNG size of 512 KiB and PNG magic-byte validation.
- No arbitrary remote image URLs and no user-authored prompts.
- Fixed enums and strict limits for player count, names, color values, and
  output fields.
- A provider timeout; late or stale results are ignored.
- No image persistence, prompt logging, or response logging beyond concise
  operational error metadata.
- The API key remains server-side.

Rate limiting controls accidental and casual abuse; it is not presented as
authentication. The online Durable Object's per-round idempotency is the
stronger call-count boundary for room play.

## User Interface

Add the controls to both local deck settings and the online host settings. Copy
will make the gameplay boundary explicit:

- **AI critic:** "Titles, guesses and reviews the finished piece."
- **AI detective:** "Names a suspect after your ballots. Never counts."
- **Tone:** Witty / Savage / Absurd.

Add a focused `CriticVerdict` screen in the established exhibition/editorial
style rather than embedding a chat transcript into `Reveal`. It will show
the finished drawing, use the invented title as the headline, keep the review
compact, and label the detective section **Non-binding opinion**.

The existing reveal's museum label uses the AI title when present instead of
`Untitled`, while still displaying the real word. The reveal shows the
subject/detective comparison lines only for fields that exist.

## Reuse Without More Model Calls

Persisted verdicts create three additional game moments:

1. The permanent archive page will show each piece's AI title, rating, and
   short review when present.
2. The final exhibition will show **Critic's Choice**, the highest-rated
   non-voided round with a ready rating.
3. The final exhibition will report the critic's subject-recognition and
   detective accuracy across eligible rounds.

Ties for Critic's Choice go to the earliest round. Accuracy uses the existing
fuzzy word matcher and exact player-ID comparison. These are deterministic
views over existing verdicts; there is no second end-of-game AI call.

Published archive validation treats all critic fields as optional and
sanitizes them, preserving compatibility with previously published archives.

## Testing and Verification

### Reducer and state tests

- New-game and legacy-state setting defaults.
- AI critic and detective independence.
- Tone and setting validation.
- Request, ready, unavailable, and skip transitions.
- Stale request IDs and stale round results are rejected.
- Late results after skip or next round are rejected.
- Detective picks are limited to eligible non-dropped artists.
- Voided rounds never require a verdict.

### Protocol and Worker tests

- A ready verdict is redacted during `guessing`.
- The verdict becomes visible only after `outcome` is set.
- Concurrent online requests produce one provider invocation.
- Room token, phase, round, content-length, PNG signature, and payload limits
  are enforced.
- Structured output is sanitized and invalid picks are removed or rejected.
- Provider error, timeout, malformed output, and missing-key behavior become
  non-blocking unavailable states.
- Local endpoint rate limiting is applied.

### UI tests

- Controls appear in both game modes and tone is conditional.
- Critic-only, detective-only, combined, and disabled cards render correctly.
- Tally and fake guess always precede the verdict.
- Pending, skip, offline, and unavailable flows allow immediate continuation.
- Reveal comparison copy is correct for right and wrong guesses.
- Old archives render without critic data and new archives render with it.
- Final Critic's Choice and accuracy summaries are deterministic.

### Completion gates

- Existing and new Vitest suites pass.
- Application and Worker TypeScript checks pass.
- Production build succeeds.
- Real-browser smoke tests cover one local round and one multi-client online
  round, including a provider failure or offline case.
- Inspect the built client bundle to confirm `OPENAI_API_KEY` and its value are
  absent.

## Out of Scope

- An AI ballot that affects accusation, scoring, ties, or fake-artist rules.
- Showing AI output before the round outcome is settled.
- AI-generated words, live drawing commentary, or coaching.
- A second informed critique after the real word is revealed.
- An end-of-game model call.
- Storing uploaded critic images.
