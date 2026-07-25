// Core game model for The Uninvited Painter.
// One authoritative state object per room; both modes run the same reducer
// (local mode keeps it in memory, online mode keeps it in the Durable Object).

export type DeckId = "animals" | "food" | "movies" | "objects" | "everything";
export type QmMode = "rotate" | "off";
export type Mode = "local" | "online";

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
}

export interface Player {
  id: string;
  name: string;
  colorIndex: number;
  score: number;
  connected: boolean;
}

export interface Settings {
  deckId: DeckId;
  rounds: number; // 3 | 5 | 7
  qmMode: QmMode;
}

export interface RoundState {
  roundNo: number; // 1-based
  word: string;
  category: string; // display name of the deck the word came from
  qmId: string | null;
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
}

export interface ArchiveEntry {
  roundNo: number;
  word: string;
  strokes: Stroke[];
  outcome: Outcome;
  fakeName: string;
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
}

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
  | { type: "DEAL" } // QM confirms the word; cards go out
  | { type: "MARK_SEEN"; playerId: string }
  | { type: "COMMIT_STROKE"; playerId: string; points: StrokePoints }
  | { type: "CAST_VOTE"; voterId: string; targetId: string; now: number }
  | { type: "SUBMIT_GUESS"; playerId: string; text: string; matched: boolean }
  | { type: "GUESS_TIMEOUT"; now: number }
  | { type: "EXTEND_GUESS"; now: number } // restart the guess clock (local hand-off, unpause)
  | { type: "DROP_PLAYER"; playerId: string; now: number } // carry on without them (mid-round)
  | { type: "VOID_ROUND" } // fake artist dropped — round voided, re-dealt
  | { type: "CLOSE_GAME" }
  | { type: "PLAY_AGAIN" };

export type ReduceResult =
  | { ok: true; state: RoomState }
  | { ok: false; error: string };
