// The round state machine. One authoritative state object per room; both modes
// run this same reducer — local mode in memory, online mode inside the Durable
// Object. The reducer is pure and deterministic: all randomness (word choice,
// role assignment) is decided by the caller and carried in on the event.

import {
  GRACE_MS,
  GUESS_MS,
  HOLD_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MIN_STROKE_COORDS,
  type GameEvent,
  type Player,
  type ReduceResult,
  type RoomState,
  type RoundState,
  type Settings,
} from "./types";
import { SEAT_COLORS } from "./palette";

/** Committed strokes cap out well above the client's own sampling limit. */
const MAX_STROKE_COORDS = 2400;

export { GRACE_MS, GUESS_MS, HOLD_MS, MIN_PLAYERS, MAX_PLAYERS };

export function createRoom(params: {
  code: string;
  mode: RoomState["mode"];
  hostId: string;
  settings?: Partial<Settings>;
}): RoomState {
  return {
    code: params.code,
    mode: params.mode,
    hostId: params.hostId,
    phase: "lobby",
    players: [],
    settings: { deckId: "animals", rounds: 5, qmMode: "rotate", ...params.settings },
    round: null,
    archive: [],
    usedWords: [],
    fakeCounts: {},
    qmIndex: 0,
    roundsPlayed: 0,
    holds: {},
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function playerById(state: RoomState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

/** Artists still in the round (dropped players excluded). */
export function activeArtists(round: RoundState): string[] {
  return round.turnOrder.filter((id) => !round.droppedIds.includes(id));
}

export function currentDrawerId(state: RoomState): string | null {
  const r = state.round;
  if (!r || state.phase !== "drawing") return null;
  return r.schedule[r.turnIndex] ?? null;
}

export function strokesRemaining(round: RoundState): number {
  return round.schedule.length - round.turnIndex;
}

/** Everyone required to see their card before drawing starts. */
export function mustSee(round: RoundState): string[] {
  const ids = activeArtists(round);
  return round.qmId ? [round.qmId, ...ids] : ids;
}

export function voteTally(round: RoundState): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const target of Object.values(round.votes)) {
    tally[target] = (tally[target] ?? 0) + 1;
  }
  return tally;
}

/** Unique top vote-getter, or null on a tie (ties acquit). */
export function accusedFromVotes(round: RoundState): string | null {
  const tally = voteTally(round);
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

export function isGamePaused(state: RoomState): boolean {
  return (
    Object.keys(state.holds).length > 0 &&
    (state.phase === "drawing" || state.phase === "voting" || state.phase === "guessing")
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
    });
  }
  state.phase = "reveal";
  // The reveal waits on host taps — make sure the host seat is a live one.
  ensureLiveHost(state);
}

function resolveVotesIfComplete(state: RoomState, now: number): void {
  const round = state.round!;
  const voters = activeArtists(round);
  if (!voters.every((id) => round.votes[id] !== undefined)) return;
  if (Object.keys(state.holds).length > 0) return; // paused — a held seat may return and re-vote
  const accused = accusedFromVotes(round);
  round.accusedId = accused;
  if (accused !== null && accused === round.fakeId) {
    state.phase = "guessing";
    round.guessDeadline = now + GUESS_MS;
  } else {
    finishRound(state, "survived");
  }
}

export function reduce(prev: RoomState, event: GameEvent): ReduceResult {
  const state = clone(prev);
  const round = state.round;

  switch (event.type) {
    case "ADD_PLAYER": {
      // Late arrivals are allowed — they sit out the current round and join the next.
      if (state.phase === "closed") return fail("The exhibition has closed");
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
      const player = playerById(state, event.playerId);
      if (!player) return fail("No such player");
      const trimmed = event.name.trim().slice(0, 18);
      if (!trimmed) return fail("A name is required");
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
      if (![3, 5, 7].includes(next.rounds)) return fail("Rounds must be 3, 5 or 7");
      state.settings = next;
      return { ok: true, state };
    }

    case "SET_CONNECTED": {
      const player = playerById(state, event.playerId);
      if (!player) return fail("No such player");
      player.connected = event.connected;
      // Only seats that are actually in the round get held — a spectator or
      // late joiner dropping their tab must not pause the game.
      const inRound =
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
        // The pause ate into the fake's guess clock — give it back.
        if (
          event.connected &&
          state.phase === "guessing" &&
          state.round &&
          Object.keys(state.holds).length === 0
        ) {
          state.round.guessDeadline = Math.max(
            state.round.guessDeadline ?? 0,
            event.now + 10_000,
          );
        }
      }
      if (!event.connected && (state.phase === "lobby" || state.phase === "reveal" || state.phase === "closed")) {
        // Host duties gate progress in these phases; don't strand the room.
        ensureLiveHost(state);
      }
      return { ok: true, state };
    }

    case "START_ROUND": {
      if (state.phase !== "lobby" && state.phase !== "reveal") {
        return fail("A round is already underway");
      }
      if (state.phase === "reveal" && state.roundsPlayed >= state.settings.rounds) {
        return fail("The exhibition is over — close the game");
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

      state.round = {
        roundNo: state.roundsPlayed + 1,
        word: event.word,
        category: event.category,
        qmId: event.qmId,
        fakeId: event.fakeId,
        turnOrder: event.turnOrder,
        schedule: [...event.turnOrder, ...event.turnOrder],
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
      return { ok: true, state };
    }

    case "MARK_SEEN": {
      if (state.phase !== "dealing" || !round) return fail("Not dealing");
      if (!round.dealt) return fail("Cards are not out yet");
      if (!mustSee(round).includes(event.playerId)) return fail("Not in this round");
      if (!round.seen.includes(event.playerId)) round.seen.push(event.playerId);
      if (mustSee(round).every((id) => round.seen.includes(id))) {
        state.phase = "drawing";
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
      const player = playerById(state, event.playerId)!;
      round.strokes.push({
        playerId: event.playerId,
        colorIndex: player.colorIndex,
        points: event.points.map((n) => Math.min(1, Math.max(0, n))),
      });
      round.turnIndex += 1;
      if (round.turnIndex >= round.schedule.length) {
        state.phase = "voting";
      }
      return { ok: true, state };
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
      if (!round || state.phase === "lobby" || state.phase === "closed") {
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
        if (round.dealt && mustSee(round).every((id) => round.seen.includes(id))) {
          state.phase = "drawing";
        }
      } else if (state.phase === "drawing") {
        if (activeArtists(round).length < 2) return fail("Too few artists left — void the round");
        if (round.turnIndex >= round.schedule.length) state.phase = "voting";
      } else if (state.phase === "voting") {
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
      if (round.qmId !== null) state.qmIndex = Math.max(0, state.qmIndex - 1);
      state.holds = {};
      finishRound(state, "voided");
      return { ok: true, state };
    }

    case "CLOSE_GAME": {
      if (state.phase !== "reveal") return fail("Not at a reveal");
      if (state.roundsPlayed < state.settings.rounds) return fail("Rounds remain");
      state.phase = "closed";
      state.round = null;
      return { ok: true, state };
    }

    case "PLAY_AGAIN": {
      if (state.phase !== "closed") return fail("The exhibition is still open");
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
