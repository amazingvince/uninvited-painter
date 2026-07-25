# AI Critic, Detective, and Real-World Rendition

Date: 2026-07-25

## Summary

Add an optional OpenAI-powered post-round exhibition to The Uninvited
Painter. As soon as drawing closes and voting begins, two hidden jobs start in
parallel:

- Luna 5.6 examines the wordless finished drawing and prepares a blind title,
  subject guess, rating, review, player-stroke callout, and optional fake-artist
  pick.
- GPT Image 2 receives the same drawing plus the authoritative secret word and
  turns it into a realistic rendition that deliberately preserves the group's
  strange geometry, colors, scale, composition, and overlaps.

Neither result is shown during voting or the fake artist's guess. Once the
official outcome is settled, the game presents Luna's blind verdict, the human
result and attribution, then the original-versus-rendition reveal. The pair is
reused in the final gallery and published archive.

The official game remains entirely human-decided. AI never casts a counted
ballot, changes scores, supplies the fake artist's guess, or blocks progression.
The same feature works in online rooms and pass-one-phone games when a network
connection and server-side OpenAI key are available. Core local play remains
fully playable without AI.

## Product Decisions

### Settings

Add three settings:

- `aiCritic: boolean`: show Luna's title, subject guess, rating, review, and
  optional player-stroke callout.
- `aiDetective: boolean`: show Luna's separate, non-scoring fake-artist pick and
  reason.
- `aiTone: "witty" | "savage" | "absurd"`: control Luna's voice whenever
  either AI feature is enabled.

Defaults for a new or normalized game:

- AI critic: on
- AI detective: off
- Tone: witty

The critic and detective are independent. A group may enable either or both.
The tone control appears when at least one is on.

GPT Image 2 is not a fourth setting. A realistic rendition is an automatic part
of every AI-enabled round, where AI-enabled means `aiCritic || aiDetective`.
This keeps the promised post-round flow consistent rather than adding a second
opt-in that can silently remove its finale.

Tone definitions:

- **Witty:** dry museum-curator shade.
- **Savage:** sharper and more direct, while attacking only the artwork and
  choices visible on the canvas.
- **Absurd:** surreal art-world nonsense delivered with complete confidence.

All tones prohibit insults about identity, appearance, intelligence,
disability, personal worth, or other off-canvas traits. The player-specific
line is limited to one light jab per round and must discuss that player's
visible color or stroke. Luna may omit it when there is not enough visual
evidence.

### Round sequence

Human voting and scoring keep their existing rules. AI work begins earlier but
remains hidden:

1. The last drawing turn ends and the shared game enters `voting`.
2. The active client renders one clean 1024 by 1024 wordless PNG and uploads it
   to an authenticated server route.
3. The server creates one idempotent post-round job. Luna's blind analysis and
   the GPT Image 2 rendition start concurrently in the background.
4. Human artists submit their sealed ballots exactly as they do today.
5. The human tally appears. If accused, the fake artist gets the existing timed
   word guess.
6. Once the outcome is settled, **Critic's Verdict** presents Luna's title,
   blind guess, rating, review, callout, and optional non-binding suspect.
7. The official reveal names the real word, fake artist, votes, winner, and
   whether Luna's blind subject and detective guesses happened to be right.
8. **What It Was / What It Became** reveals the original drawing beside the GPT
   Image 2 rendition.
9. Standings and the normal next-round action remain available.

No AI output is exposed before step 6. In particular, the rendition receives
the real word server-side but remains inaccessible to players until the outcome
is public. Luna never receives the real word, fake identity, votes, scores, or
outcome.

The Critic's Verdict contains only enabled sections:

- invented artwork title;
- blind subject guess;
- integer rating from 1 through 10 and a short rating tag;
- review of no more than two short sentences;
- optional player-stroke callout;
- optional non-scoring suspect and one-sentence reason.

The official reveal derives two compact comparison payoffs without another
model call:

- whether Luna's subject guess matches the real word using the game's existing
  fuzzy matcher; and
- whether Luna selected the actual fake artist.

Confidently wrong answers are part of the entertainment.

### Slow and failed jobs

AI never holds the ballot, fake-artist guess, official result, next round, game
close, save, or archive controls.

If a result is not ready when its card is reached:

- show a compact in-world pending card;
- keep the next-round control enabled;
- continue listening for the existing job instead of creating a replacement;
- attach a late result to its archived round even if play has moved on; and
- update the final gallery or published archive when the result becomes
  available.

Examples of pending or failure copy:

- Pending rendition: "Reality is still negotiating with the line work."
- Offline: "No connection, no opinion. Refreshing."
- Provider or validation failure: "The critic has declined to defend its
  opinion."
- Moderation block: "This masterpiece could not clear the velvet rope."

Critique and rendition succeed or fail independently. A failed critic does not
hide a successful rendition, and a failed rendition does not remove the
critique.

## Shared Data Model

Add bounded shared types along these lines:

```ts
type AiTone = "witty" | "savage" | "absurd";
type AiJobStatus =
  | "idle"
  | "pending"
  | "ready"
  | "unavailable";

interface CriticVerdict {
  title?: string;
  subjectGuess?: string;
  confidence?: number;
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

interface RoundAi {
  jobId: string | null;
  criticStatus: AiJobStatus;
  critic: CriticVerdict | null;
  renditionStatus: AiJobStatus;
  renditionId: string | null;
}
```

`RoundState` gets one `ai` field initialized to idle. The reducer receives
explicit events for starting a job and applying sanitized critic/rendition
results or failures. Nondeterministic provider responses are carried inside
events so the shared reducer stays deterministic.

`ArchiveEntry` accepts optional sanitized critic fields and an opaque
`renditionId`. Old saved rooms and published archives remain valid;
`normalizeRoom` supplies new setting and state defaults for legacy data.

Only enabled critic sections are stored. `rating` is an integer from 1 through
10, confidence is bounded, and all strings have server-enforced length limits.
Returned player IDs must refer to eligible, non-dropped artists in the current
round. The detective can never select the question master.

The state stores status and opaque identifiers, never generated image bytes,
base64 payloads, prompts, or API credentials.

## Reference Image

Reuse the existing client-side vector renderer and extract a dedicated AI
reference export:

- 1024 by 1024 PNG;
- the same paper, colors, rounded lines, stroke order, and composition players
  saw;
- no caption, title, word, player name, vote, score, border, or other hint; and
- a strict upload limit with PNG signature and decoded-dimension checks.

The browser uploads the PNG once when the game first enters voting. In an
online room it also supplies the room code, round number, and private player
token. The Durable Object obtains the authoritative word, settings, candidate
IDs, color mapping, and state; it does not trust client-supplied prompts,
candidates, or tone.

In local mode, the endpoint validates the bounded word, player/color legend,
settings, and round identifiers supplied by the single-device game. The result
cannot affect official play.

The uploaded source is temporarily stored in private object storage so a
durable background workflow does not depend on the initiating browser request
remaining open.

## OpenAI Integrations

`OPENAI_API_KEY` is read only in the Cloudflare server environment. The
existing ignored `.env` supplies it to local Wrangler development. Production
uses a Wrangler secret with the same name. The key must not use a `VITE_`
prefix, enter client state, or be included in a browser request or bundle.

### Luna 5.6 critic

Use the OpenAI Responses API with:

- `gpt-5.6-luna` as the fixed default;
- an optional server-only `OPENAI_CRITIC_MODEL` override;
- `reasoning.effort: "low"`;
- the wordless PNG as vision input;
- a fixed developer instruction selected by `aiTone`;
- an anonymous stable-player-ID and color legend;
- strict structured output for the verdict; and
- a small output-token limit appropriate for the bounded copy.

The prompt explicitly says Luna is blind to the intended word and must discuss
only visible artwork. Player names are not sent. Stable IDs and colors are
delimited as data, not instructions. The browser resolves a returned player ID
to a display name after validation.

If `aiCritic` is on, title, subject guess, confidence, rating, rating tag, and
review are required; the player callout remains optional. If `aiCritic` is off,
all critic fields are omitted. If `aiDetective` is on, a valid eligible-player
pick and reason are required; if it is off, both detective fields are omitted.

The server validates and normalizes parsed output again even though Structured
Outputs is used. Invalid optional fields are dropped. An invalid required
section, HTTP error, timeout, or unparseable response marks only the critic
portion unavailable.

### GPT Image 2 rendition

Use the Image API's edit endpoint for a single reference-image transformation:

- model: `gpt-image-2`;
- input: the wordless 1024px drawing;
- prompt: the authoritative word plus fixed faithfulness instructions;
- size: `1024x1024`;
- quality: `medium`;
- output format: `jpeg`;
- output compression: approximately 85; and
- moderation: default `auto`.

Do not set `input_fidelity`; GPT Image 2 processes image inputs at high
fidelity automatically.

The fixed rendition prompt says, in substance:

> Create a cinematic, believable real-world rendition of the intended subject
> using this drawing as the composition authority. Preserve every odd relative
> size, position, direction, silhouette, dominant stroke color, overlap,
> negative space, and awkward detail. Treat apparent mistakes as intentional.
> Do not add text, captions, borders, signatures, or improve the composition
> into generic tasteful artwork.

The real word is necessary to interpret the collaborative drawing, but the
request contains no player names, roles, votes, scores, house words, or critic
result. Luna's title labels the pair later; the image request does not wait for
the title.

## Background Workflow

Add one Cloudflare Workflow for post-round AI work. A Worker/room route starts
it only after validating and storing the source image. Its stable instance ID
is derived from game identity plus round number, making duplicate starts
idempotent.

The workflow:

1. loads the private reference image;
2. starts the independent Luna and GPT Image 2 calls concurrently;
3. sanitizes the structured critic output;
4. stores the generated JPEG in private object storage;
5. records ready or unavailable status for each independent branch; and
6. publishes a server-owned completion back to the room or local job record.

Provider calls are isolated workflow steps, but the image step must not blindly
retry an ambiguous failure: the first generation may have succeeded and an
automatic replay could create a duplicate charge. Known pre-generation
rate-limit or server failures may expose a deliberate retry action later; user
errors and moderation blocks are non-retryable.

The source image and job status allow the workflow to outlive a refresh,
reconnect, closed initiating request, or device moving to the next round.

## Online Data Flow and Redaction

When the online game first enters voting, one eligible active client uploads
the reference. The Durable Object verifies:

- the token still maps to a seated player;
- the room and round are current;
- the phase is voting or later;
- at least one AI feature is enabled;
- the round is not voided;
- the uploaded file is a valid bounded 1024px PNG; and
- no job already exists for the round.

The first valid request atomically assigns the job ID and persists pending
status before starting the workflow. Later requests observe the same job and
cannot create another OpenAI call.

The room accepts completion only from the server-owned workflow and only when
the game identity, round number, and job ID still match. It persists the result
and broadcasts newly visible state.

Protocol redaction may expose pending/unavailable status during voting, but it
must omit:

- the ready critic verdict;
- the rendition ID or image route;
- the real word and fake identity; and
- any provider metadata

until the outcome is public. Spectators and players receive the same AI
exhibition after that boundary.

## Local Data Flow

Pass-one-phone mode watches for the first transition into voting, renders the
same wordless PNG, and starts a local post-round job through the Worker. It
stores the opaque job ID and polls with bounded backoff or receives the final
response when ready.

A response applies only when the job and round IDs still match. Moving to a new
round does not cancel or replace the old job; a late result updates the matching
archive entry and final gallery.

A missing connection or server configuration fails quickly into unavailable.
The PWA never loops provider requests and never requires connectivity to
continue playing.

Because the local endpoint lacks room membership, it receives the additional
rate and input controls below.

## Storage and Retention

Keep archive JSON metadata in the existing `ARCHIVES` KV namespace. Add one
private R2 binding for binary AI artwork:

- temporary source key: `jobs/{jobId}/source.png`;
- temporary rendition key: `jobs/{jobId}/rendition.jpg`;
- published rendition key:
  `archives/{archiveId}/round-{roundNo}-rendition.jpg`.

Room/reducer state and KV metadata store only opaque IDs. Worker routes map
those IDs to R2 keys and serve images with a fixed content type, cache policy,
and no directory listing. The bucket itself is not public.

Lifecycle rules expire un-published job sources and results after a short
window. Publishing an archive copies successful renditions to the archive
prefix, matching the existing one-year archive lifetime. The original drawing
remains reproducible from sanitized strokes, while the generated rendition is
the paired binary.

If an already-published job finishes late, the server adds the rendition to the
archive metadata and archive prefix without requiring another model call.

## Cost, Abuse, and Privacy Controls

- Exactly one stable workflow and at most one intended image generation per
  game round.
- No automatic client retries; refreshes and reconnects reuse the job ID.
- A Cloudflare rate-limiter binding on local and upload routes, keyed by client
  IP and reinforced by per-room/per-round idempotency.
- Exact `Content-Length` enforcement before buffering.
- A 2 MiB source upload ceiling plus PNG signature and dimension validation.
- No arbitrary remote image URLs, model names, or user-authored prompts.
- Fixed enums and strict limits for words, player count, color values, and
  output fields.
- Provider timeouts and stable job-status transitions.
- Moderation details and request IDs may be logged for operations; image bytes,
  secret words, prompts, player names, and model responses are not logged.
- Source and result objects are private and addressed by unguessable IDs.
- The API key remains server-side.

Rate limiting controls accidental and casual abuse. Online room membership and
per-round idempotency are the stronger cost boundary.

At the current published rate, a medium 1024 by 1024 GPT Image 2 output is about
$0.053 plus input tokens. A seven-round game is therefore roughly $0.37 in
image-output cost before the smaller Luna and image-input costs. Product copy
should say the option uses OpenAI credits without hard-coding a price that can
drift.

## User Interface

Add the settings to both local deck setup and the online host lobby:

- **AI critic:** "Titles, guesses and reviews the finished piece."
- **AI detective:** "Names a suspect after your ballots. Never counts."
- **Tone:** Witty / Savage / Absurd.

Add focused screens in the existing exhibition/editorial style rather than a
chat transcript:

1. `CriticVerdict` shows the original drawing, invented title, blind guess,
   rating, compact review, callout, and a **Non-binding opinion** detective
   section when enabled.
2. The official `Reveal` keeps the real human result visually dominant and adds
   only the deterministic subject/detective comparison payoffs.
3. `RenditionReveal` presents a dramatic original-to-real transition, then a
   responsive side-by-side pair labeled **What It Was** and **What It Became**.

Pending and failed branches use compact cards in the same slot so layout and
progression do not jump. The next-round control remains available. When a late
result lands after navigation, a small gallery-ready cue is enough; the game
must not pull players back to an older screen.

The existing museum label uses Luna's title when present instead of `Untitled`,
while still displaying the real word.

## Reuse Without More Model Calls

Persisted results create additional game moments:

1. Every final-gallery tile can expand into the original/rendition pair with
   Luna's title, rating, and review.
2. The permanent archive page shows the same pair and metadata when present.
3. The final exhibition shows **Critic's Choice**, the highest-rated non-voided
   round with a ready rating.
4. The final exhibition reports Luna's subject-recognition and detective
   accuracy across eligible rounds.

Ties for Critic's Choice go to the earliest round. Accuracy uses the existing
fuzzy word matcher and exact player-ID comparison. All are deterministic views
over stored results; there is no end-of-game model call.

Published archive validation treats every AI field as optional and sanitizes
it, preserving compatibility with old archives and partially successful jobs.

## Error Handling

- Missing `OPENAI_API_KEY`: both branches become unavailable with no external
  call.
- Luna HTTP, timeout, parse, or schema failure: critic unavailable; rendition
  continues.
- Image user error or moderation block: rendition unavailable; do not retry the
  same request.
- Known transient provider failure: record operational metadata and expose a
  deliberate future retry path rather than silently generating again.
- R2 write failure after successful generation: report unavailable and retain
  the provider request ID for diagnosis; never put base64 in room state.
- Stale completion: update the matching archive/job record when safe, but never
  overwrite a newer round's visible state.
- Deleted/expired source: fail the unfinished branch cleanly.
- Archive promotion failure: the live result remains usable; publishing reports
  a recoverable partial-archive error.

No failure path changes votes, outcome, score, progression, or the ability to
save the original vector artwork.

## Testing and Verification

### Shared engine and protocol

- New-game and legacy-state AI defaults.
- Critic/detective independence and automatic rendition enablement.
- One matching job per round; duplicate and stale events rejected.
- Critic and rendition independent status transitions.
- Eligible callout/detective IDs and bounded structured fields.
- No ready result or image ID before `outcome` is public.
- Late completion updates the matching archive rather than the active round.
- Old room/archive normalization remains valid.

### Provider modules

- Luna request uses `gpt-5.6-luna`, low reasoning, image input, fixed tone
  instructions, anonymous player IDs, and strict structured output.
- Luna request never contains the word, fake identity, vote, score, outcome,
  house words, or player display names.
- Image edit uses `gpt-image-2`, the source PNG, authoritative word, 1024 square,
  medium quality, JPEG output, and fixed preserve-the-weirdness prompt.
- Image request never contains player identity or game-result data.
- Schema sanitizer rejects malformed, oversized, or ineligible values.
- Moderation/user errors are non-retryable; ambiguous image failures do not
  trigger a duplicate call.

### Workflow, routes, and storage

- Online membership, phase, round, file, and AI-setting checks.
- Concurrent duplicate uploads create only one workflow instance.
- Local rate limit, multipart, PNG signature, decoded dimensions, and byte cap.
- Workflow branches can complete or fail independently.
- R2 keys, content types, private serving, and archive promotion.
- Source/result lifecycle and partial archive behavior.
- Server-owned completion cannot be forged by a browser.

### UI and integration

- Both settings surfaces and all three tones.
- Background job starts on the first voting transition in local and online
  modes.
- Human voting and fake-guess screens reveal no AI hints.
- Critic, official attribution, and rendition appear in the approved order.
- Pending/failure cards never disable next round.
- A late result appears in the correct gallery tile without navigation theft.
- Final and published archives render old, partial, and full AI entries.
- Small-phone layouts, keyboard focus, reduced motion, and screen-reader labels.

### Verification ladder

1. Focused Vitest suites for reducer, protocol, providers, workflow, storage,
   route validation, and archives.
2. Type checking and production build.
3. Full repository test suite.
4. Local pass-one-phone browser run with mocked OpenAI responses.
5. Online multi-client browser run with mocked workflow completion and
   pre-outcome redaction checks.
6. One deliberate live Luna plus GPT Image 2 smoke round using the configured
   server-side key, confirming the original/rendition pair and no credential in
   browser traffic or bundle.
7. `git diff --check` and a final secret scan before completion.

## Documentation

Update README setup and gameplay notes:

- AI is optional and core local play remains usable without it.
- Luna 5.6 provides the blind critic/detective; GPT Image 2 provides the
  automatic realistic rendition.
- The feature sends the finished drawing to OpenAI only when AI is enabled.
- Local development reads the existing ignored `.env`.
- Production requires `wrangler secret put OPENAI_API_KEY`.
- Production also requires the Workflow, rate-limiter, and private R2 bindings
  and an R2 lifecycle policy for temporary job objects.
- The AI vote is ceremonial and image/critic failures never change scoring.

## Source Notes

- OpenAI recommends the Image API for a single image edit from one prompt and
  documents `gpt-image-2` as the latest GPT Image model:
  <https://developers.openai.com/api/docs/guides/image-generation>
- GPT Image 2 automatically processes reference inputs at high fidelity, and
  complex requests can take up to two minutes:
  <https://developers.openai.com/api/docs/guides/image-generation#image-input-fidelity>
- Cloudflare Workflows provide durable background steps and stable instance
  IDs:
  <https://developers.cloudflare.com/workflows/build/workers-api/>
- R2 is private object storage with strongly consistent Worker binding reads
  and writes:
  <https://developers.cloudflare.com/r2/reference/consistency/>
