// Client ↔ server wire protocol for online mode, plus the redaction layer.
// Anti-cheat: the word only ever goes to real artists' (and the QM's) sockets;
// turn order, undo eligibility and vote sealing are all enforced in the DO —
// the client never decides.

import type {
  GameEvent,
  Player,
  RoomState,
  RoundState,
  Settings,
  StrokePoints,
} from "./types";

export type Role = "artist" | "fake" | "qm";

export type ClientMsg =
  | { t: "join"; token: string; name: string; colorIndex: number }
  | { t: "rejoin"; token: string }
  | { t: "rename"; name: string }
  | { t: "setColor"; colorIndex: number }
  | { t: "settings"; settings: Partial<Settings> }
  | { t: "houseWords"; add?: string[]; remove?: string }
  | { t: "lock"; locked: boolean } // host only
  | { t: "start" } // host only
  | { t: "redraw" } // QM only, while dealing
  | { t: "deal" } // QM only
  | { t: "seen" }
  | { t: "live"; points: StrokePoints; newSegment?: boolean } // in-progress ink (ephemeral)
  | { t: "liveClear" } // undo within the grace window
  | { t: "commit"; points: StrokePoints; breaks?: number[] }
  | { t: "vote"; targetId: string }
  | { t: "guess"; text: string }
  | { t: "next" } // host: next round / re-deal after a void / close
  | { t: "again" } // host, from closed
  | { t: "dropPlayer"; playerId: string } // host: carry on without them
  | { t: "leave" };

export type ServerMsg =
  | { t: "joined"; playerId: string }
  | { t: "state"; state: PublicRoomState; you: YouView }
  | { t: "live"; playerId: string; colorIndex: number; points: StrokePoints; newSegment?: boolean }
  | { t: "liveClear"; playerId: string }
  | { t: "error"; message: string };

/** What every client may see: word, fake and ballots stripped until public. */
export interface PublicRoundState
  extends Omit<RoundState, "word" | "fakeId" | "votes" | "guess"> {
  word: string | null;
  fakeId: string | null;
  votes: Record<string, string> | null; // null while sealed
  votersIn: string[]; // who has locked a ballot in
  guess: string | null;
}

export interface PublicRoomState
  extends Omit<RoomState, "round" | "usedWords" | "fakeCounts" | "qmIndex" | "customWords"> {
  round: PublicRoundState | null;
  /** How many words are in the house pot — the words themselves stay secret. */
  houseWordCount: number;
}

export interface YouView {
  playerId: string;
  role: Role | null;
  word: string | null;
  isHost: boolean;
  /** Your own house-deck submissions (for the editor). */
  houseWords: string[];
}

export function redactState(state: RoomState, viewerId: string): { state: PublicRoomState; you: YouView } {
  const viewer = state.players.find((p) => p.id === viewerId);
  const round = state.round;
  let publicRound: PublicRoundState | null = null;
  let role: Role | null = null;
  let word: string | null = null;

  if (round) {
    if (round.qmId === viewerId) role = "qm";
    else if (round.fakeId === viewerId) role = "fake";
    else if (round.turnOrder.includes(viewerId)) role = "artist";

    // The word goes to real artists and the QM — never to the fake.
    if (role === "artist" || role === "qm") word = round.word;

    // A voided round was never played out — its word goes back in the deck,
    // so it must not ship to anyone.
    const revealed =
      (state.phase === "reveal" || state.phase === "closed") && round.outcome !== "voided";
    // Once the vote resolves (guessing or reveal), the accusation is public.
    const votesPublic = revealed || state.phase === "guessing";
    const publicAi = revealed
      ? round.ai
      : {
          jobId: null,
          criticStatus: round.ai.criticStatus,
          critic: null,
          renditionStatus: round.ai.renditionStatus,
          renditionId: null,
        };
    publicRound = {
      ...round,
      word: revealed ? round.word : null,
      fakeId: revealed || state.phase === "guessing" ? round.fakeId : null,
      votes: votesPublic ? round.votes : null,
      votersIn: Object.keys(round.votes),
      guess: revealed ? round.guess : null,
      ai: publicAi,
    };
  }

  const { round: _r, usedWords: _u, fakeCounts: _f, qmIndex: _q, customWords: _c, ...rest } = state;
  // Archive stroke data only ships once the exhibition closes (C6 needs it);
  // during play the entries travel light to keep state broadcasts small.
  const archive =
    state.phase === "closed"
      ? rest.archive
      : rest.archive.map((entry) => ({ ...entry, strokes: [] }));
  return {
    state: {
      ...rest,
      archive,
      round: publicRound,
      houseWordCount: state.customWords.length,
    },
    you: {
      playerId: viewerId,
      role,
      word,
      isHost: state.hostId === viewerId && !!viewer,
      houseWords: state.customWords
        .filter((w) => w.authorId === viewerId)
        .map((w) => w.word),
    },
  };
}

/** Type helper for building events with less noise in the DO. */
export type { GameEvent, Player, RoomState, Settings };
