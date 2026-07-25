// Core game model for The Uninvited Painter.
// One authoritative state object per room; both modes run the same reducer
// (local mode keeps it in memory, online mode keeps it in the Durable Object).

/** Single source of truth: the validator and the type cannot drift apart. */
export const DECK_IDS = [
  "animals",
  "food",
  "movies",
  "objects",
  "everything",
  "house",
] as const;
export type DeckId = (typeof DECK_IDS)[number];
export type QmMode = "rotate" | "off";
export type Mode = "local" | "online";
export type WinMode = "rounds" | "score10";
export type AiTone = "witty" | "savage" | "absurd";
export type AiJobStatus = "idle" | "pending" | "ready" | "unavailable";

export interface CriticVerdict {
  title?: string;
  subjectGuess?: string;
  confidence?: number;
  rating?: number;
  ratingTag?: string;
  review?: string;
  callout?: { playerId: string; text: string };
  detective?: { playerId: string; reason: string };
}

export interface RoundAi {
  jobId: string | null;
  criticStatus: AiJobStatus;
  critic: CriticVerdict | null;
  renditionStatus: AiJobStatus;
  renditionId: string | null;
}

export type Phase =
  | "lobby"
  | "dealing"
  | "drawing"
  | "voting"
  | "guessing"
  | "reveal"
  | "closed";

export type Outcome = "survived" | "caught_named" | "caught_wrong" | "voided";

/** Flat [x0, y0, x1, y1, ...] with coordinates normalised 0..1 on a square canvas. */
export type StrokePoints = number[];

export interface Stroke {
  playerId: string;
  colorIndex: number;
  points: StrokePoints;
  /** Free-pen turns: coordinate-pair indices where a new segment begins
   *  (the pen lifted). Absent/empty = one unbroken line. */
  breaks?: number[];
}

export interface Player {
  id: string;
  name: string;
  colorIndex: number;
  score: number;
  connected: boolean;
}

export type PenMode = "line" | "free";
export type Presence = "strict" | "relaxed";

export interface Settings {
  deckId: DeckId;
  rounds: number; // 3 | 5 | 7
  qmMode: QmMode;
  /** Strokes per artist per round. */
  passes: number; // 1 | 2 | 3
  /** Seconds per drawing turn (0 = no clock). Online only; voting gets 2×. */
  strokeClock: number; // 0 | 60 | 90
  winMode: WinMode;
  /** "line": one unbroken line, lifting ends the turn. "free": draw several
   *  segments inside the ink budget, an explicit End Turn submits. */
  penMode: PenMode;
  /** Ink budget per turn as a percentage of the canvas width (0 = unlimited). */
  inkLimit: number; // 0 | 60 | 120
  /** "strict": disconnects pause the game and seats auto-drop after 30s.
   *  "relaxed": the room just waits — nobody is forced to keep the app open. */
  presence: Presence;
  aiCritic: boolean;
  aiDetective: boolean;
  aiTone: AiTone;
}

export interface HouseWord {
  word: string;
  authorId: string;
}

export interface RoundState {
  roundNo: number; // 1-based
  word: string;
  category: string; // display name of the deck the word came from
  qmId: string | null;
  /** Whether the round was dealt with a question master. Survives the QM being
   *  dropped (which nulls qmId), so a void can still rewind the rotation. */
  hadQm?: boolean;
  fakeId: string;
  /** Artists (everyone except the QM) in play order. */
  turnOrder: string[];
  /** Full stroke schedule: two passes over turnOrder. Entries after turnIndex
   *  are removed when a player is dropped mid-round. */
  schedule: string[];
  turnIndex: number;
  /** QM has confirmed the word (auto-true when qmMode is off). */
  dealt: boolean;
  /** Players (artists + QM) who have seen their card. */
  seen: string[];
  strokes: Stroke[];
  votes: Record<string, string>; // voterId -> targetId, sealed until all in
  droppedIds: string[];
  accusedId: string | null;
  guess: string | null;
  outcome: Outcome | null;
  scoreDelta: Record<string, number>;
  guessDeadline: number | null; // epoch ms
  /** Stroke-clock deadline for the current drawing turn (or the whole ballot
   *  while voting). null when the clock is off. */
  turnDeadline: number | null;
  ai: RoundAi;
}

export interface ArchiveEntry {
  roundNo: number;
  word: string;
  strokes: Stroke[];
  outcome: Outcome;
  fakeName: string;
  /** Eligible anonymous artist IDs retained for validating late AI results. */
  artistIds?: string[];
  ai?: RoundAi;
  fakeId?: string;
  criticSubjectMatched?: boolean;
  criticDetectiveMatched?: boolean;
}

export interface RoomState {
  code: string; // "" in local mode
  mode: Mode;
  hostId: string;
  phase: Phase;
  players: Player[];
  settings: Settings;
  round: RoundState | null;
  archive: ArchiveEntry[];
  usedWords: string[];
  /** How many times each player has been the fake — duty rotates before repeating. */
  fakeCounts: Record<string, number>;
  /** Rotating pointer for question-master duty. */
  qmIndex: number;
  roundsPlayed: number;
  /** Disconnected mid-round: playerId -> seat-hold deadline (epoch ms). */
  holds: Record<string, number>;
  /** The house deck: words written by the players themselves. */
  customWords: HouseWord[];
  /** Host has closed the room to newcomers. A 4-letter code is short enough
   *  to say out loud, which also makes it short enough to guess. */
  locked?: boolean;
}

export const HOUSE_MIN_WORDS = 12;
export const HOUSE_MAX_WORDS = 100;
export const HOUSE_WORD_MAX_LEN = 24;
export const SCORE_TARGET = 10;
export const SCORE_MIN_ROUNDS = 3;

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;
export const GRACE_MS = 4_000; // undo window after lifting the pen
export const GUESS_MS = 30_000; // fake artist's guess timer
export const HOLD_MS = 30_000; // seat hold on disconnect
export const ROOM_TTL_MS = 15 * 60_000; // rooms stay warm 15 min after last player leaves
export const MIN_STROKE_COORDS = 6; // fewer than 3 points is rejected as a mis-tap

// ---------------------------------------------------------------------------
// Events — the reducer input. All randomness (word, roles) is decided by the
// caller and carried in the event so the reducer stays deterministic.
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: "ADD_PLAYER"; player: { id: string; name: string; colorIndex: number } }
  | { type: "REMOVE_PLAYER"; playerId: string }
  | { type: "RENAME_PLAYER"; playerId: string; name: string }
  | { type: "SET_COLOR"; playerId: string; colorIndex: number }
  | { type: "REORDER_PLAYERS"; order: string[] }
  | { type: "SET_SETTINGS"; settings: Partial<Settings> }
  | { type: "SET_LOCKED"; locked: boolean }
  | { type: "SET_CONNECTED"; playerId: string; connected: boolean; now: number }
  | {
      type: "START_ROUND";
      word: string;
      category: string;
      qmId: string | null;
      fakeId: string;
      turnOrder: string[];
    }
  | { type: "REDRAW_WORD"; word: string; category: string }
  | { type: "DEAL"; now: number } // QM confirms the word; cards go out
  | { type: "MARK_SEEN"; playerId: string; now: number }
  | { type: "COMMIT_STROKE"; playerId: string; points: StrokePoints; breaks?: number[]; now: number }
  | { type: "TURN_TIMEOUT"; now: number } // stroke clock ran out
  | { type: "ADD_HOUSE_WORDS"; playerId: string; words: string[] }
  | { type: "REMOVE_HOUSE_WORD"; playerId: string; word: string }
  | { type: "CAST_VOTE"; voterId: string; targetId: string; now: number }
  | { type: "SUBMIT_GUESS"; playerId: string; text: string; matched: boolean }
  | { type: "GUESS_TIMEOUT"; now: number }
  | { type: "EXTEND_GUESS"; now: number } // restart the guess clock (local hand-off, unpause)
  | { type: "START_ROUND_AI"; roundNo: number; jobId: string }
  | {
      type: "RESOLVE_ROUND_CRITIC";
      roundNo: number;
      jobId: string;
      verdict: CriticVerdict;
    }
  | { type: "FAIL_ROUND_CRITIC"; roundNo: number; jobId: string }
  | {
      type: "RESOLVE_ROUND_RENDITION";
      roundNo: number;
      jobId: string;
      renditionId: string;
    }
  | { type: "FAIL_ROUND_RENDITION"; roundNo: number; jobId: string }
  | { type: "DROP_PLAYER"; playerId: string; now: number } // carry on without them (mid-round)
  | { type: "VOID_ROUND" } // fake artist dropped — round voided, re-dealt
  | { type: "CLOSE_GAME" }
  | { type: "PLAY_AGAIN" };

export type ReduceResult =
  | { ok: true; state: RoomState }
  | { ok: false; error: string };
