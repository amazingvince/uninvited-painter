// The round state machine. One authoritative state object per room; both modes
// run this same reducer — local mode in memory, online mode inside the Durable
// Object. The reducer is pure and deterministic: all randomness (word choice,
// role assignment) is decided by the caller and carried in on the event.

import {
  DECK_IDS,
  GUESS_MS,
  HOLD_MS,
  HOUSE_MAX_WORDS,
  HOUSE_MIN_WORDS,
  HOUSE_WORD_MAX_LEN,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MIN_STROKE_COORDS,
  SCORE_MIN_ROUNDS,
  SCORE_TARGET,
  type GameEvent,
  type ArchiveEntry,
  type CriticVerdict,
  type Player,
  type ReduceResult,
  type RoundAi,
  type RoomState,
  type RoundState,
  type Settings,
} from "./types";
import { criticGuessMatches } from "./fuzzy";
import { SEAT_COLORS } from "./palette";
import { strokeLength, validSegments } from "./geometry";
import { parseCriticVerdict } from "./criticVerdict";
import { AI_ID_RE } from "./ids";

/** Committed strokes cap out well above the client's own sampling limit. */
const MAX_STROKE_COORDS = 2400;

/**
 * Clamp to the canvas and round to the millimetre.
 *
 * Raw pointer samples serialise as ~18 characters each ("0.4632107023411371").
 * A 12-player, 3-pass round is thousands of them, stored twice once the round
 * is archived — enough to push a Durable Object past its per-value ceiling
 * (which bricks the room) and a saved local game past the localStorage quota.
 * Three decimals is finer than the board ever renders.
 */
function quantise(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

export function aiEnabled(
  settings: Pick<Settings, "aiCritic" | "aiDetective">,
): boolean {
  return settings.aiCritic || settings.aiDetective;
}

export function emptyRoundAi(): RoundAi {
  return {
    jobId: null,
    criticStatus: "idle",
    critic: null,
    renditionStatus: "idle",
    renditionId: null,
  };
}

const DEFAULT_SETTINGS: Settings = {
  deckId: "animals",
  rounds: 5,
  qmMode: "rotate",
  passes: 2,
  strokeClock: 0,
  winMode: "rounds",
  penMode: "line",
  inkLimit: 0,
  presence: "strict",
  aiCritic: true,
  aiDetective: false,
  aiTone: "witty",
};

export function createRoom(params: {
  code: string;
  mode: RoomState["mode"];
  hostId: string;
  settings?: Partial<Settings>;
}): RoomState {
  return {
    code: params.code,
    mode: params.mode,
    gameNo: 1,
    roundVersion: 0,
    hostId: params.hostId,
    phase: "lobby",
    players: [],
    settings: { ...DEFAULT_SETTINGS, ...params.settings },
    round: null,
    archive: [],
    usedWords: [],
    fakeCounts: {},
    qmIndex: 0,
    roundsPlayed: 0,
    holds: {},
    customWords: [],
    locked: false,
  };
}

/** Fill fields added after a state was persisted — old rooms survive deploys. */
export function normalizeRoom(state: RoomState): RoomState {
  state.gameNo ??= 1;
  state.roundVersion ??= state.round ? 1 : 0;
  const s = (state.settings ?? {}) as Partial<Settings>;
  state.settings = {
    deckId: s.deckId ?? DEFAULT_SETTINGS.deckId,
    rounds: s.rounds ?? DEFAULT_SETTINGS.rounds,
    qmMode: s.qmMode ?? DEFAULT_SETTINGS.qmMode,
    passes: s.passes ?? DEFAULT_SETTINGS.passes,
    strokeClock: s.strokeClock ?? DEFAULT_SETTINGS.strokeClock,
    winMode: s.winMode ?? DEFAULT_SETTINGS.winMode,
    penMode: s.penMode ?? DEFAULT_SETTINGS.penMode,
    inkLimit: s.inkLimit ?? DEFAULT_SETTINGS.inkLimit,
    presence: s.presence ?? DEFAULT_SETTINGS.presence,
    aiCritic: s.aiCritic ?? DEFAULT_SETTINGS.aiCritic,
    aiDetective: s.aiDetective ?? DEFAULT_SETTINGS.aiDetective,
    aiTone: s.aiTone ?? DEFAULT_SETTINGS.aiTone,
  };
  state.customWords ??= [];
  state.locked ??= false;
  if (state.round) {
    state.round.turnDeadline ??= null;
    state.round.ai ??= emptyRoundAi();
    state.round.hadQm ??= state.round.qmId !== null;
  }
  for (const entry of state.archive ?? []) {
    entry.ai ??= emptyRoundAi();
  }
  return state;
}

/** Has the exhibition run its course? (fixed rounds, or first to the target)
 *  Accepts the redacted public state too — it only reads public fields. */
export function isGameOver(
  state: Pick<RoomState, "settings" | "roundsPlayed" | "players">,
): boolean {
  if (state.settings.winMode === "score10") {
    return (
      state.roundsPlayed >= SCORE_MIN_ROUNDS &&
      state.players.some((p) => p.score >= SCORE_TARGET)
    );
  }
  return state.roundsPlayed >= state.settings.rounds;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function playerById(state: RoomState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

// These take structural picks rather than the full RoundState so the redacted
// PublicRoundState satisfies them too — otherwise the online client has to
// re-derive the same rules by hand, which is exactly how they drift.

/** Artists still in the round (dropped players excluded). */
export function activeArtists(
  round: Pick<RoundState, "turnOrder" | "droppedIds">,
): string[] {
  return round.turnOrder.filter((id) => !round.droppedIds.includes(id));
}

/** Whose turn it is, given a round that is currently in the drawing phase. */
export function drawerOf(
  round: Pick<RoundState, "schedule" | "turnIndex">,
): string | null {
  return round.schedule[round.turnIndex] ?? null;
}

/** Which pass (1-based) the current turn belongs to for that drawer. */
export function passOf(
  round: Pick<RoundState, "schedule" | "turnIndex">,
  playerId: string | null,
): number {
  if (!playerId) return 1;
  return (
    round.schedule.slice(0, round.turnIndex).filter((id) => id === playerId).length + 1
  );
}

export function currentDrawerId(state: RoomState): string | null {
  if (!state.round || state.phase !== "drawing") return null;
  return drawerOf(state.round);
}

/** Everyone required to see their card before drawing starts. */
export function mustSee(
  round: Pick<RoundState, "turnOrder" | "droppedIds" | "qmId">,
): string[] {
  const ids = activeArtists(round);
  return round.qmId ? [round.qmId, ...ids] : ids;
}

export function voteTally(votes: Record<string, string>): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const target of Object.values(votes)) {
    tally[target] = (tally[target] ?? 0) + 1;
  }
  return tally;
}

/** Unique top vote-getter, or null on a tie (ties acquit). */
export function accusedFromVotes(
  round: Pick<RoundState, "votes">,
): string | null {
  const tally = voteTally(round.votes);
  let best: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [id, count] of Object.entries(tally)) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** A held seat freezes the round. "dealing" counts — SET_CONNECTED takes a
 *  hold there too, so leaving it out told the player the room was live when
 *  every action was already being refused. */
export function isGamePaused(
  state: Pick<RoomState, "holds" | "phase">,
): boolean {
  return (
    Object.keys(state.holds).length > 0 &&
    (state.phase === "dealing" ||
      state.phase === "drawing" ||
      state.phase === "voting" ||
      state.phase === "guessing")
  );
}

/**
 * Pick who plays the fake: random among the eligible artists who have played
 * fake the fewest times — nobody plays it twice before everyone has.
 */
export function pickFake(
  state: RoomState,
  artistIds: string[],
  rng: () => number = Math.random,
): string {
  const min = Math.min(...artistIds.map((id) => state.fakeCounts[id] ?? 0));
  const pool = artistIds.filter((id) => (state.fakeCounts[id] ?? 0) === min);
  return pool[Math.floor(rng() * pool.length)];
}

/** Next question master under rotation (skipping absent players), or null when off. */
export function pickQm(state: RoomState): string | null {
  if (state.settings.qmMode === "off" || state.players.length === 0) return null;
  const n = state.players.length;
  for (let i = 0; i < n; i++) {
    const player = state.players[(state.qmIndex + i) % n];
    if (player.connected) return player.id;
  }
  return null;
}

/** If the host's seat is dark, pass hosting duty to a connected player. */
function ensureLiveHost(state: RoomState): void {
  const host = state.players.find((p) => p.id === state.hostId);
  if (host?.connected) return;
  const next = state.players.find((p) => p.connected);
  if (next) state.hostId = next.id;
}

// ---------------------------------------------------------------------------
// Scoring resolution — survived → fake +2, QM +2. caught & guessed right →
// fake +2, QM +2. caught & wrong → every real artist +1. A tie in the vote
// counts as survived.
// ---------------------------------------------------------------------------

function scoreRound(round: RoundState): Record<string, number> {
  const delta: Record<string, number> = {};
  if (round.outcome === "voided" || round.outcome === null) return delta;
  if (round.outcome === "survived" || round.outcome === "caught_named") {
    delta[round.fakeId] = 2;
    if (round.qmId) delta[round.qmId] = 2;
  } else {
    for (const id of activeArtists(round)) {
      if (id !== round.fakeId) delta[id] = 1;
    }
  }
  return delta;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function clone(state: RoomState): RoomState {
  return JSON.parse(JSON.stringify(state)) as RoomState;
}

function fail(error: string): ReduceResult {
  return { ok: false, error };
}


function validateVerdict(
  settings: Settings,
  eligible: Set<string>,
  verdict: CriticVerdict,
): CriticVerdict | string {
  // Completeness was already enforced at the provider boundary; what the
  // engine adds is that every named player still belongs to this round.
  // Re-requiring the detective here would reject a verdict whose suspect was
  // dropped between the upload and the result — throwing away a paid review
  // to protect a line of flavour text.
  return parseCriticVerdict(verdict, {
    eligibleIds: eligible,
    requireCritic: settings.aiCritic,
  });
}

function archiveForRound(state: RoomState, roundNo: number): ArchiveEntry | undefined {
  return state.archive.find((entry) => entry.roundNo === roundNo);
}

function aiTargets(
  state: RoomState,
  roundNo: number,
): { ai: RoundAi; eligible: Set<string>; archive?: ArchiveEntry }[] {
  const targets: { ai: RoundAi; eligible: Set<string>; archive?: ArchiveEntry }[] = [];
  if (state.round?.roundNo === roundNo) {
    targets.push({
      ai: state.round.ai,
      eligible: new Set(activeArtists(state.round)),
    });
  }
  const archive = archiveForRound(state, roundNo);
  if (archive?.ai) {
    targets.push({
      ai: archive.ai,
      eligible: new Set(
        archive.artistIds ??
          archive.strokes.map((stroke) => stroke.playerId).filter(Boolean),
      ),
      archive,
    });
  }
  return targets;
}

/**
 * The targets a result may still land on: same job, still waiting. A target
 * that never got the job stamped (or already settled) is skipped rather than
 * failing the whole result — one stale copy must not bin a paid verdict.
 */
function aiPendingTargets(
  state: RoomState,
  roundNo: number,
  jobId: string,
  branch: "critic" | "rendition",
): { ai: RoundAi; eligible: Set<string>; archive?: ArchiveEntry }[] {
  return aiTargets(state, roundNo).filter(
    ({ ai }) =>
      ai.jobId === jobId &&
      (branch === "critic"
        ? ai.criticStatus === "pending"
        : ai.renditionStatus === "pending"),
  );
}

function updateCriticMatches(entry: ArchiveEntry): void {
  const verdict = entry.ai?.critic;
  if (!verdict) return;
  if (verdict.subjectGuess) {
    entry.criticSubjectMatched = criticGuessMatches(verdict.subjectGuess, entry.word);
  }
  if (verdict.detective && entry.fakeId) {
    entry.criticDetectiveMatched = verdict.detective.playerId === entry.fakeId;
  }
}

function finishRound(state: RoomState, outcome: NonNullable<RoundState["outcome"]>): void {
  const round = state.round!;
  round.outcome = outcome;
  round.scoreDelta = scoreRound(round);
  for (const [id, points] of Object.entries(round.scoreDelta)) {
    const player = playerById(state, id);
    if (player) player.score += points;
  }
  if (outcome !== "voided") {
    state.roundsPlayed += 1;
    const fake = playerById(state, round.fakeId);
    state.archive.push({
      roundNo: round.roundNo,
      word: round.word,
      strokes: round.strokes,
      outcome,
      fakeName: fake?.name ?? "?",
      artistIds: activeArtists(round),
      fakeId: round.fakeId,
      ai: round.ai,
    });
    updateCriticMatches(state.archive[state.archive.length - 1]);
  }
  state.phase = "reveal";
  round.turnDeadline = null;
  // A seat hold belongs to the round that created it. Left standing it pauses
  // the *next* round on behalf of someone who isn't even in it — the room sits
  // frozen until the hold expires and the alarm drops them.
  state.holds = {};
  // The reveal waits on host taps — make sure the host seat is a live one.
  ensureLiveHost(state);
}

function resolveVotesIfComplete(state: RoomState, now: number): void {
  const round = state.round!;
  const voters = activeArtists(round);
  if (!voters.every((id) => round.votes[id] !== undefined)) return;
  if (Object.keys(state.holds).length > 0) return; // paused — a held seat may return and re-vote
  resolveVotes(state, now);
}

/** Count whatever ballots exist and move on — the all-in path and the
 *  ballot-clock timeout both end here. */
function resolveVotes(state: RoomState, now: number): void {
  const round = state.round!;
  const accused = accusedFromVotes(round);
  round.accusedId = accused;
  round.turnDeadline = null;
  if (accused !== null && accused === round.fakeId) {
    state.phase = "guessing";
    round.guessDeadline = now + GUESS_MS;
  } else {
    finishRound(state, "survived");
  }
}

/** Arm (or clear) the stroke clock for the current turn / the whole ballot. */
function armTurnClock(state: RoomState, now: number): void {
  const round = state.round;
  if (!round) return;
  const clock = state.settings.strokeClock;
  if (!clock) {
    round.turnDeadline = null;
  } else if (state.phase === "drawing") {
    round.turnDeadline = now + clock * 1000;
  } else if (state.phase === "voting") {
    round.turnDeadline = now + 2 * clock * 1000;
  } else {
    round.turnDeadline = null;
  }
}

export function reduce(prev: RoomState, event: GameEvent): ReduceResult {
  const state = clone(prev);
  const round = state.round;

  switch (event.type) {
    case "ADD_PLAYER": {
      // Late arrivals are allowed — they sit out the current round and join the next.
      if (state.phase === "closed") return fail("The exhibition has closed");
      if (state.locked) return fail("The room is locked");
      if (state.players.length >= MAX_PLAYERS) return fail("Room is full (12 max)");
      const { id, name, colorIndex } = event.player;
      if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex >= SEAT_COLORS.length) {
        return fail("Bad colour");
      }
      const trimmed = name.trim().slice(0, 18);
      if (!trimmed) return fail("A name is required");
      if (state.players.some((p) => p.id === id)) return fail("Already joined");
      if (state.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
        return fail("That name is taken");
      }
      if (state.players.some((p) => p.colorIndex === colorIndex)) {
        return fail("That colour is taken");
      }
      state.players.push({ id, name: trimmed, colorIndex, score: 0, connected: true });
      if (!state.hostId) state.hostId = id;
      return { ok: true, state };
    }

    case "REMOVE_PLAYER": {
      if (state.phase !== "lobby") return fail("Players can only be removed in the lobby");
      state.players = state.players.filter((p) => p.id !== event.playerId);
      if (state.hostId === event.playerId) {
        // An emptied room must let the next joiner claim hosting duty.
        state.hostId = state.players.length > 0 ? state.players[0].id : "";
      }
      return { ok: true, state };
    }

    case "RENAME_PLAYER": {
      // Names are fixed once the game starts, exactly as colours are: two
      // identical names on the ballot make the vote ambiguous, and letting
      // anyone take a rival's name mid-round is an impersonation gift.
      if (state.phase !== "lobby") return fail("Names are fixed once the game starts");
      const player = playerById(state, event.playerId);
      if (!player) return fail("No such player");
      const trimmed = event.name.trim().slice(0, 18);
      if (!trimmed) return fail("A name is required");
      if (trimmed === player.name) return { ok: true, state }; // no-op, don't broadcast
      if (
        state.players.some(
          (p) => p.id !== player.id && p.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        return fail("That name is taken");
      }
      player.name = trimmed;
      return { ok: true, state };
    }

    case "SET_COLOR": {
      if (state.phase !== "lobby") return fail("Colours are fixed once the game starts");
      if (
        !Number.isInteger(event.colorIndex) ||
        event.colorIndex < 0 ||
        event.colorIndex >= SEAT_COLORS.length
      ) {
        return fail("Bad colour");
      }
      const player = playerById(state, event.playerId);
      if (!player) return fail("No such player");
      if (state.players.some((p) => p.id !== player.id && p.colorIndex === event.colorIndex)) {
        return fail("That colour is taken");
      }
      player.colorIndex = event.colorIndex;
      return { ok: true, state };
    }

    case "REORDER_PLAYERS": {
      if (state.phase !== "lobby") return fail("Order is fixed once the game starts");
      const byId = new Map(state.players.map((p) => [p.id, p]));
      if (
        event.order.length !== state.players.length ||
        !event.order.every((id) => byId.has(id))
      ) {
        return fail("Bad order");
      }
      state.players = event.order.map((id) => byId.get(id)!);
      return { ok: true, state };
    }

    case "SET_SETTINGS": {
      if (state.phase !== "lobby") return fail("Settings are fixed once the game starts");
      const next = { ...state.settings, ...event.settings };
      // deckId and qmMode are validated too: an unknown deck is persisted
      // happily and then throws inside prepareRoundEvent, which the DO can
      // only report as "Something went wrong" on every future round start.
      if (!DECK_IDS.includes(next.deckId)) return fail("Bad deck");
      if (!["rotate", "off"].includes(next.qmMode)) return fail("Bad QM mode");
      if (![3, 5, 7].includes(next.rounds)) return fail("Rounds must be 3, 5 or 7");
      if (![1, 2, 3].includes(next.passes)) return fail("Passes must be 1, 2 or 3");
      if (![0, 60, 90].includes(next.strokeClock)) return fail("Bad stroke clock");
      if (!["rounds", "score10"].includes(next.winMode)) return fail("Bad win mode");
      if (!["line", "free"].includes(next.penMode)) return fail("Bad pen mode");
      if (![0, 60, 120].includes(next.inkLimit)) return fail("Bad ink limit");
      if (!["strict", "relaxed"].includes(next.presence)) return fail("Bad presence mode");
      if (!["witty", "savage", "absurd"].includes(next.aiTone)) return fail("Bad AI tone");
      state.settings = next;
      return { ok: true, state };
    }

    case "SET_LOCKED": {
      if (state.phase === "closed") return fail("The exhibition has closed");
      state.locked = event.locked;
      return { ok: true, state };
    }

    case "START_ROUND_AI": {
      if (!round || round.roundNo !== event.roundNo) return fail("Stale AI round");
      if (!aiEnabled(state.settings)) return fail("AI is disabled");
      if (!["voting", "guessing", "reveal"].includes(state.phase)) {
        return fail("AI starts after drawing");
      }
      if (round.outcome === "voided") return fail("Round was voided");
      if (round.ai.jobId !== null) return fail("AI job already started");
      if (!AI_ID_RE.test(event.jobId)) {
        return fail("Bad AI job");
      }
      const started: RoundAi = {
        jobId: event.jobId,
        criticStatus: "pending",
        critic: null,
        renditionStatus: "pending",
        renditionId: null,
      };
      round.ai = started;
      // A job started in the reveal phase must also mark the archive entry —
      // it was written while the round's AI was still idle, and a result that
      // can't match every target would otherwise be discarded.
      const archived = archiveForRound(state, event.roundNo);
      if (archived && archived.ai?.jobId == null) archived.ai = { ...started };
      return { ok: true, state };
    }

    case "RESOLVE_ROUND_CRITIC": {
      const targets = aiPendingTargets(state, event.roundNo, event.jobId, "critic");
      if (targets.length === 0) return fail("Stale AI job");
      const eligible = new Set(targets.flatMap((target) => [...target.eligible]));
      const verdict = validateVerdict(state.settings, eligible, event.verdict);
      if (typeof verdict === "string") return fail(verdict);
      for (const target of targets) {
        target.ai.critic = verdict;
        target.ai.criticStatus = "ready";
        if (target.archive) updateCriticMatches(target.archive);
      }
      return { ok: true, state };
    }

    case "FAIL_ROUND_CRITIC": {
      const targets = aiPendingTargets(state, event.roundNo, event.jobId, "critic");
      if (targets.length === 0) return fail("Stale AI job");
      for (const { ai } of targets) {
        ai.criticStatus = "unavailable";
        ai.critic = null;
      }
      return { ok: true, state };
    }

    case "RESOLVE_ROUND_RENDITION": {
      if (!AI_ID_RE.test(event.renditionId)) return fail("Bad rendition");
      const targets = aiPendingTargets(state, event.roundNo, event.jobId, "rendition");
      if (targets.length === 0) return fail("Stale AI job");
      for (const { ai } of targets) {
        ai.renditionStatus = "ready";
        ai.renditionId = event.renditionId;
      }
      return { ok: true, state };
    }

    case "FAIL_ROUND_RENDITION": {
      const targets = aiPendingTargets(state, event.roundNo, event.jobId, "rendition");
      if (targets.length === 0) return fail("Stale AI job");
      for (const { ai } of targets) {
        ai.renditionStatus = "unavailable";
        ai.renditionId = null;
      }
      return { ok: true, state };
    }

    case "ADD_HOUSE_WORDS": {
      if (state.phase !== "lobby") return fail("House words are written in the lobby");
      // authorId "" = the table wrote it (local mode, shared phone) — no
      // author to protect, so the fake-exclusion rule simply never applies.
      if (event.playerId !== "" && !playerById(state, event.playerId)) {
        return fail("No such player");
      }
      // Dedupe only against the caller's OWN words — deduping against the
      // whole pot would let anyone probe whether a word is already in it
      // (a membership oracle on the supposedly-secret house deck).
      const own = new Set(
        state.customWords
          .filter((w) => w.authorId === event.playerId)
          .map((w) => w.word.toLowerCase()),
      );
      for (const raw of event.words.slice(0, 20)) {
        const word = String(raw).trim().slice(0, HOUSE_WORD_MAX_LEN);
        if (word.length < 2) continue;
        if (own.has(word.toLowerCase())) continue;
        if (state.customWords.length >= HOUSE_MAX_WORDS) break;
        state.customWords.push({ word, authorId: event.playerId });
        own.add(word.toLowerCase());
      }
      return { ok: true, state };
    }

    case "REMOVE_HOUSE_WORD": {
      if (state.phase !== "lobby") return fail("House words are fixed once the game starts");
      state.customWords = state.customWords.filter(
        (w) => !(w.authorId === event.playerId && w.word === event.word),
      );
      return { ok: true, state };
    }

    case "SET_CONNECTED": {
      const player = playerById(state, event.playerId);
      if (!player) return fail("No such player");
      player.connected = event.connected;
      // Only seats that are actually in the round get held — a spectator or
      // late joiner dropping their tab must not pause the game. In relaxed
      // rooms nobody is held at all: the game simply waits.
      const inRound =
        state.settings.presence === "strict" &&
        state.round !== null &&
        (state.phase === "dealing" ||
          state.phase === "drawing" ||
          state.phase === "voting" ||
          state.phase === "guessing") &&
        !state.round.droppedIds.includes(event.playerId) &&
        (state.round.turnOrder.includes(event.playerId) ||
          state.round.qmId === event.playerId);
      if (!event.connected && inRound) {
        state.holds[event.playerId] = event.now + HOLD_MS;
      } else {
        delete state.holds[event.playerId];
        // A completed ballot may have been waiting on this held seat.
        if (state.phase === "voting" && state.round) {
          resolveVotesIfComplete(state, event.now);
        }
        // The pause ate into the running clocks — give some time back.
        if (event.connected && state.round && Object.keys(state.holds).length === 0) {
          if (state.phase === "guessing") {
            state.round.guessDeadline = Math.max(
              state.round.guessDeadline ?? 0,
              event.now + 10_000,
            );
          }
          if (
            (state.phase === "drawing" || state.phase === "voting") &&
            state.round.turnDeadline !== null
          ) {
            state.round.turnDeadline = Math.max(state.round.turnDeadline, event.now + 10_000);
          }
        }
      }
      // Host duty gates progress in every phase, so it must never sit on a
      // dark seat. This used to run only in lobby/reveal/closed, which left a
      // relaxed room permanently deadlocked when the host vanished mid-round:
      // no hold is taken there, so no alarm ever fires, and drop and void are
      // both host-only — nobody left could unstick it.
      if (!event.connected) ensureLiveHost(state);
      return { ok: true, state };
    }

    case "START_ROUND": {
      if (state.phase !== "lobby" && state.phase !== "reveal") {
        return fail("A round is already underway");
      }
      if (state.phase === "reveal" && isGameOver(state)) {
        return fail("The exhibition is over — close the game");
      }
      if (state.settings.deckId === "house" && state.customWords.length < HOUSE_MIN_WORDS) {
        return fail(`The house deck needs at least ${HOUSE_MIN_WORDS} words`);
      }
      const ids = state.players.map((p) => p.id);
      if (event.qmId !== null && !ids.includes(event.qmId)) return fail("Bad QM");
      if (!event.turnOrder.every((id) => ids.includes(id))) return fail("Bad turn order");
      if (new Set(event.turnOrder).size !== event.turnOrder.length) return fail("Bad turn order");
      if (event.qmId !== null && event.turnOrder.includes(event.qmId)) {
        return fail("The QM does not draw");
      }
      if (!event.turnOrder.includes(event.fakeId)) return fail("Bad fake artist");
      // Absent players sit rounds out, so the round may be smaller than the roster.
      const participants = event.turnOrder.length + (event.qmId !== null ? 1 : 0);
      if (participants < MIN_PLAYERS) {
        return fail(`Needs at least ${MIN_PLAYERS} players present`);
      }

      state.roundVersion += 1;
      state.round = {
        roundNo: state.roundsPlayed + 1,
        word: event.word,
        category: event.category,
        qmId: event.qmId,
        hadQm: event.qmId !== null,
        fakeId: event.fakeId,
        turnOrder: event.turnOrder,
        schedule: Array.from({ length: state.settings.passes }, () => event.turnOrder).flat(),
        turnIndex: 0,
        dealt: event.qmId === null, // no QM → cards go straight out
        seen: [],
        strokes: [],
        votes: {},
        droppedIds: [],
        accusedId: null,
        guess: null,
        outcome: null,
        scoreDelta: {},
        guessDeadline: null,
        turnDeadline: null,
        ai: emptyRoundAi(),
      };
      state.usedWords.push(event.word);
      state.fakeCounts[event.fakeId] = (state.fakeCounts[event.fakeId] ?? 0) + 1;
      if (event.qmId !== null) state.qmIndex += 1;
      state.phase = "dealing";
      return { ok: true, state };
    }

    case "REDRAW_WORD": {
      if (state.phase !== "dealing" || !round) return fail("Not dealing");
      if (round.dealt) return fail("Cards are already out");
      state.usedWords = state.usedWords.filter((w) => w !== round.word);
      round.word = event.word;
      round.category = event.category;
      state.usedWords.push(event.word);
      return { ok: true, state };
    }

    case "DEAL": {
      if (state.phase !== "dealing" || !round) return fail("Not dealing");
      if (round.dealt) return fail("Cards are already out");
      round.dealt = true;
      // The QM has been staring at the word all along.
      if (round.qmId) round.seen.push(round.qmId);
      if (mustSee(round).every((id) => round.seen.includes(id))) {
        state.phase = "drawing";
        armTurnClock(state, event.now);
      }
      return { ok: true, state };
    }

    case "MARK_SEEN": {
      if (state.phase !== "dealing" || !round) return fail("Not dealing");
      if (!round.dealt) return fail("Cards are not out yet");
      if (!mustSee(round).includes(event.playerId)) return fail("Not in this round");
      if (!round.seen.includes(event.playerId)) round.seen.push(event.playerId);
      if (mustSee(round).every((id) => round.seen.includes(id))) {
        state.phase = "drawing";
        armTurnClock(state, event.now);
      }
      return { ok: true, state };
    }

    case "COMMIT_STROKE": {
      if (state.phase !== "drawing" || !round) return fail("Not drawing");
      if (Object.keys(state.holds).length > 0) return fail("Paused — a seat is being held");
      if (round.schedule[round.turnIndex] !== event.playerId) return fail("Not your turn");
      if (event.points.length < MIN_STROKE_COORDS || event.points.length % 2 !== 0) {
        return fail("That looked like a mis-tap — draw a line");
      }
      if (event.points.length > MAX_STROKE_COORDS) return fail("Stroke too long");
      if (!event.points.every((n) => typeof n === "number" && n >= -0.01 && n <= 1.01)) {
        return fail("Stroke out of bounds");
      }
      const breaks = event.breaks ?? [];
      if (breaks.length > 0 && state.settings.penMode !== "free") {
        return fail("One unbroken line — the pen never lifts in this room");
      }
      if (breaks.length > 24 || !validSegments(event.points, breaks)) {
        return fail("Bad stroke segments");
      }
      if (state.settings.inkLimit > 0) {
        // Slack for float noise only — the client meters with the same math.
        if (strokeLength(event.points, breaks) > (state.settings.inkLimit / 100) * 1.02) {
          return fail("That is more ink than the turn allows");
        }
      }
      const player = playerById(state, event.playerId)!;
      round.strokes.push({
        playerId: event.playerId,
        colorIndex: player.colorIndex,
        points: event.points.map(quantise),
        ...(breaks.length > 0 ? { breaks } : {}),
      });
      round.turnIndex += 1;
      if (round.turnIndex >= round.schedule.length) {
        state.phase = "voting";
      }
      armTurnClock(state, event.now);
      return { ok: true, state };
    }

    case "TURN_TIMEOUT": {
      if (!round || round.turnDeadline === null) return fail("No clock running");
      if (Object.keys(state.holds).length > 0) return fail("Paused");
      if (event.now < round.turnDeadline) return fail("Not yet");
      if (state.phase === "drawing") {
        // The turn is forfeited — the pass moves on without a stroke.
        round.turnIndex += 1;
        if (round.turnIndex >= round.schedule.length) {
          state.phase = "voting";
        }
        armTurnClock(state, event.now);
        return { ok: true, state };
      }
      if (state.phase === "voting") {
        // Ballot clock: count whatever is in. No ballots at all = a tie = acquittal.
        resolveVotes(state, event.now);
        return { ok: true, state };
      }
      return fail("No clock in this phase");
    }

    case "CAST_VOTE": {
      if (state.phase !== "voting" || !round) return fail("Not voting");
      const voters = activeArtists(round);
      if (!voters.includes(event.voterId)) return fail("You don't vote this round");
      if (round.votes[event.voterId] !== undefined) return fail("Ballot already locked in");
      if (event.voterId === event.targetId) return fail("You can't vote for yourself");
      if (!voters.includes(event.targetId)) return fail("Bad target");
      round.votes[event.voterId] = event.targetId;
      resolveVotesIfComplete(state, event.now);
      return { ok: true, state };
    }

    case "SUBMIT_GUESS": {
      if (state.phase !== "guessing" || !round) return fail("Not guessing");
      if (event.playerId !== round.fakeId) return fail("Only the accused guesses");
      if (round.guessDeadline !== null && event.now >= round.guessDeadline) {
        if (Object.keys(state.holds).length > 0) return fail("Paused");
        round.guess = null;
        finishRound(state, "caught_wrong");
        return { ok: true, state };
      }
      round.guess = event.text.trim().slice(0, 60);
      finishRound(state, event.matched ? "caught_named" : "caught_wrong");
      return { ok: true, state };
    }

    case "GUESS_TIMEOUT": {
      if (state.phase !== "guessing" || !round) return fail("Not guessing");
      if (Object.keys(state.holds).length > 0) return fail("Paused");
      if (round.guessDeadline !== null && event.now < round.guessDeadline) {
        return fail("Not yet");
      }
      round.guess = null;
      finishRound(state, "caught_wrong");
      return { ok: true, state };
    }

    case "EXTEND_GUESS": {
      if (state.phase !== "guessing" || !round) return fail("Not guessing");
      round.guessDeadline = event.now + GUESS_MS;
      return { ok: true, state };
    }

    case "DROP_PLAYER": {
      // "reveal" is refused as well: that round is scored and archived, and
      // dropping into it would delete ballots from a tally already shown on
      // screen and already paid out in points.
      if (
        !round ||
        state.phase === "lobby" ||
        state.phase === "reveal" ||
        state.phase === "closed"
      ) {
        return fail("No round to drop from");
      }
      if (round.droppedIds.includes(event.playerId)) return fail("Already dropped");
      if (event.playerId === round.fakeId) {
        return fail("If the fake artist drops, the round is voided — use VOID_ROUND");
      }
      delete state.holds[event.playerId];
      if (event.playerId === round.qmId) {
        // QM leaving: the word is already set; the round simply loses its QM
        // bonus seat. If they hadn't dealt yet, the cards go out without them.
        round.qmId = null;
        round.dealt = true;
        round.seen = round.seen.filter((id) => id !== event.playerId);
      }
      if (round.turnOrder.includes(event.playerId)) {
        round.droppedIds.push(event.playerId);
        // Remove their remaining turns; committed strokes stay on the wall.
        round.schedule = round.schedule.filter(
          (id, i) => i < round.turnIndex || id !== event.playerId,
        );
        delete round.votes[event.playerId];
        // Ballots cast for the dropped player reopen.
        for (const [voter, target] of Object.entries(round.votes)) {
          if (target === event.playerId) delete round.votes[voter];
        }
      }
      if (state.phase === "dealing") {
        // Same floor the drawing and voting branches enforce — without it a
        // round can reach the ballot with one artist left, who may not vote
        // for themselves and so can never resolve it.
        if (activeArtists(round).length < 2) {
          return fail("Too few artists left — void the round");
        }
        if (round.dealt && mustSee(round).every((id) => round.seen.includes(id))) {
          state.phase = "drawing";
          armTurnClock(state, event.now);
        }
      } else if (state.phase === "drawing") {
        if (activeArtists(round).length < 2) return fail("Too few artists left — void the round");
        if (round.turnIndex >= round.schedule.length) state.phase = "voting";
        armTurnClock(state, event.now);
      } else if (state.phase === "voting") {
        if (activeArtists(round).length < 2) {
          return fail("Too few artists left — void the round");
        }
        // Reopened ballots need breathing room: a ballot clock that expired
        // during the pause must not fire the instant the drop lands.
        if (round.turnDeadline !== null && Object.keys(state.holds).length === 0) {
          round.turnDeadline = Math.max(round.turnDeadline, event.now + 10_000);
        }
        resolveVotesIfComplete(state, event.now);
      } else if (state.phase === "guessing" && Object.keys(state.holds).length === 0) {
        // The pause ate into the fake's guess clock — give some back.
        round.guessDeadline = Math.max(round.guessDeadline ?? 0, event.now + 10_000);
      }
      ensureLiveHost(state);
      return { ok: true, state };
    }

    case "VOID_ROUND": {
      if (!round || state.phase === "lobby" || state.phase === "closed" || state.phase === "reveal") {
        return fail("No round to void");
      }
      // Give the word back and undo the duty ticks — the round never happened.
      state.usedWords = state.usedWords.filter((w) => w !== round.word);
      state.fakeCounts[round.fakeId] = Math.max(0, (state.fakeCounts[round.fakeId] ?? 1) - 1);
      // hadQm, not qmId: a QM who was dropped mid-round has already had qmId
      // nulled, and testing that would skip the rewind and cost them their
      // turn at question-master duty in a round that never happened.
      if (round.hadQm) state.qmIndex = Math.max(0, state.qmIndex - 1);
      finishRound(state, "voided"); // clears the holds too
      return { ok: true, state };
    }

    case "CLOSE_GAME": {
      if (state.phase !== "reveal") return fail("Not at a reveal");
      if (!isGameOver(state)) return fail("Rounds remain");
      state.phase = "closed";
      state.round = null;
      return { ok: true, state };
    }

    case "PLAY_AGAIN": {
      if (state.phase !== "closed") return fail("The exhibition is still open");
      state.gameNo += 1;
      state.roundVersion = 0;
      state.phase = "lobby";
      state.round = null;
      state.archive = [];
      state.usedWords = [];
      state.roundsPlayed = 0;
      state.holds = {};
      for (const p of state.players) p.score = 0;
      // fakeCounts and qmIndex intentionally survive — duty keeps rotating.
      return { ok: true, state };
    }

    default: {
      const _exhaustive: never = event;
      return fail(`Unknown event ${String((_exhaustive as GameEvent).type)}`);
    }
  }
}
