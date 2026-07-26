import { describe, expect, it } from "vitest";
import {
  accusedFromVotes,
  normalizeRoom,
  activeArtists,
  createRoom,
  currentDrawerId,
  mustSee,
  pickFake,
  reduce,
} from "../shared/engine";
import { criticGuessMatches, guessMatches } from "../shared/fuzzy";
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "../shared/codes";
import { prepareRoundEvent } from "../shared/decks";
import type { GameEvent, RoomState } from "../shared/types";
import { redactState } from "../shared/protocol";

const NAMES = ["Devon", "Marisol", "Priya", "Tomas", "Ines", "Ade", "Jun"];

function apply(state: RoomState, event: GameEvent): RoomState {
  const result = reduce(state, event);
  if (!result.ok) throw new Error(`${event.type}: ${result.error}`);
  return result.state;
}

function expectFail(state: RoomState, event: GameEvent): string {
  const result = reduce(state, event);
  if (result.ok) throw new Error(`${event.type} unexpectedly succeeded`);
  return result.error;
}

function lobbyWith(n: number): RoomState {
  let state = createRoom({ code: "MOLT", mode: "online", hostId: "" });
  for (let i = 0; i < n; i++) {
    state = apply(state, {
      type: "ADD_PLAYER",
      player: { id: `p${i}`, name: NAMES[i] ?? `Player ${i}`, colorIndex: i },
    });
  }
  return state;
}

/** 7 players, p0 is QM, p1 is fake, artists p1..p6. */
function startedRound(): RoomState {
  let state = lobbyWith(7);
  state = apply(state, {
    type: "START_ROUND",
    word: "penguin",
    category: "Animals",
    qmId: "p0",
    fakeId: "p1",
    turnOrder: ["p1", "p2", "p3", "p4", "p5", "p6"],
  });
  return state;
}

function dealtRound(): RoomState {
  let state = startedRound();
  state = apply(state, { type: "DEAL", now: 0 });
  for (const id of ["p0", "p1", "p2", "p3", "p4", "p5", "p6"]) {
    state = apply(state, { type: "MARK_SEEN", playerId: id, now: 0 });
  }
  return state;
}

const LINE = [0.1, 0.1, 0.5, 0.5, 0.9, 0.9];

function drawAll(state: RoomState): RoomState {
  while (state.phase === "drawing") {
    state = apply(state, {
      type: "COMMIT_STROKE", now: 0,
      playerId: currentDrawerId(state)!,
      points: LINE,
    });
  }
  return state;
}

describe("lobby", () => {
  it("collects players, assigns host to the first, caps at 12", () => {
    let state = lobbyWith(12);
    expect(state.hostId).toBe("p0");
    expect(
      reduce(state, { type: "ADD_PLAYER", player: { id: "x", name: "Extra", colorIndex: 0 } }).ok,
    ).toBe(false);
  });

  it("rejects duplicate names and colours", () => {
    const state = lobbyWith(2);
    expect(expectFail(state, { type: "ADD_PLAYER", player: { id: "x", name: "devon", colorIndex: 5 } })).toMatch(/name/);
    expect(expectFail(state, { type: "ADD_PLAYER", player: { id: "x", name: "Zed", colorIndex: 0 } })).toMatch(/colour/);
  });

  it("requires five players to start", () => {
    const four = lobbyWith(4);
    expect(
      reduce(four, {
        type: "START_ROUND",
        word: "w",
        category: "c",
        qmId: null,
        fakeId: "p1",
        turnOrder: ["p0", "p1", "p2", "p3"],
      }).ok,
    ).toBe(false);
  });

  it("reorders the roster", () => {
    let state = lobbyWith(5);
    state = apply(state, { type: "REORDER_PLAYERS", order: ["p4", "p3", "p2", "p1", "p0"] });
    expect(state.players.map((p) => p.id)).toEqual(["p4", "p3", "p2", "p1", "p0"]);
  });
});

describe("start round", () => {
  it("rejects a QM inside the turn order and enters dealing", () => {
    const state = lobbyWith(7);
    expect(
      reduce(state, {
        type: "START_ROUND",
        word: "penguin",
        category: "Animals",
        qmId: "p0",
        fakeId: "p1",
        turnOrder: ["p0", "p1", "p2", "p3", "p4", "p5"],
      }).ok,
    ).toBe(false);
    const started = startedRound();
    expect(started.phase).toBe("dealing");
    expect(started.round!.schedule).toHaveLength(12); // two passes over six artists
    expect(started.round!.dealt).toBe(false);
    expect(started.fakeCounts.p1).toBe(1);
  });

  it("skips the deal gate when the QM role is off", () => {
    let state = lobbyWith(5);
    state = apply(state, {
      type: "START_ROUND",
      word: "penguin",
      category: "Animals",
      qmId: null,
      fakeId: "p2",
      turnOrder: ["p0", "p1", "p2", "p3", "p4"],
    });
    expect(state.round!.dealt).toBe(true);
    expect(mustSee(state.round!)).toHaveLength(5);
  });

  it("lets the QM redraw the word before dealing, but not after", () => {
    let state = startedRound();
    state = apply(state, { type: "REDRAW_WORD", word: "octopus", category: "Animals" });
    expect(state.round!.word).toBe("octopus");
    expect(state.usedWords).toEqual(["octopus"]);
    state = apply(state, { type: "DEAL", now: 0 });
    expect(reduce(state, { type: "REDRAW_WORD", word: "owl", category: "Animals" }).ok).toBe(false);
  });

  it("moves to drawing only after everyone has seen their card", () => {
    let state = startedRound();
    state = apply(state, { type: "DEAL", now: 0 });
    for (const id of ["p0", "p1", "p2", "p3", "p4", "p5"]) {
      state = apply(state, { type: "MARK_SEEN", playerId: id, now: 0 });
      expect(state.phase).toBe("dealing");
    }
    state = apply(state, { type: "MARK_SEEN", playerId: "p6", now: 0 });
    expect(state.phase).toBe("drawing");
  });
});

describe("drawing", () => {
  it("enforces turn order over two passes and flips to voting after 2n strokes", () => {
    let state = dealtRound();
    expect(currentDrawerId(state)).toBe("p1");
    expect(reduce(state, { type: "COMMIT_STROKE", playerId: "p2", points: LINE, now: 0 }).ok).toBe(false);
    state = drawAll(state);
    expect(state.round!.strokes).toHaveLength(12);
    expect(state.phase).toBe("voting");
  });

  it("rejects mis-taps (fewer than 3 points)", () => {
    const state = dealtRound();
    expect(reduce(state, { type: "COMMIT_STROKE", playerId: "p1", points: [0.5, 0.5, 0.6, 0.6], now: 0 }).ok).toBe(false);
  });

  it("stamps the drawer's colour on the stroke", () => {
    let state = dealtRound();
    state = apply(state, { type: "COMMIT_STROKE", playerId: "p1", points: LINE, now: 0 });
    expect(state.round!.strokes[0].colorIndex).toBe(1);
  });
});

describe("voting and outcomes", () => {
  it("seals ballots, blocks self-votes and non-artists, and QM abstains", () => {
    let state = drawAll(dealtRound());
    expect(reduce(state, { type: "CAST_VOTE", voterId: "p0", targetId: "p1", now: 0 }).ok).toBe(false);
    expect(reduce(state, { type: "CAST_VOTE", voterId: "p2", targetId: "p2", now: 0 }).ok).toBe(false);
    expect(reduce(state, { type: "CAST_VOTE", voterId: "p2", targetId: "p0", now: 0 }).ok).toBe(false);
    state = apply(state, { type: "CAST_VOTE", voterId: "p2", targetId: "p1", now: 0 });
    expect(reduce(state, { type: "CAST_VOTE", voterId: "p2", targetId: "p3", now: 0 }).ok).toBe(false);
  });

  it("catches the fake → guessing; right guess steals the round (+2 fake, +2 QM)", () => {
    let state = drawAll(dealtRound());
    for (const voter of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p1" ? "p2" : "p1",
        now: 1000,
      });
    }
    expect(state.phase).toBe("guessing");
    expect(state.round!.accusedId).toBe("p1");
    expect(state.round!.guessDeadline).toBe(31_000);
    state = apply(state, { type: "SUBMIT_GUESS", playerId: "p1", text: "penguins", matched: true });
    expect(state.phase).toBe("reveal");
    expect(state.round!.outcome).toBe("caught_named");
    expect(state.players.find((p) => p.id === "p1")!.score).toBe(2);
    expect(state.players.find((p) => p.id === "p0")!.score).toBe(2);
    expect(state.players.find((p) => p.id === "p2")!.score).toBe(0);
    expect(state.roundsPlayed).toBe(1);
    expect(state.archive).toHaveLength(1);
  });

  it("wrong guess → +1 to every real artist, nothing for the QM", () => {
    let state = drawAll(dealtRound());
    for (const voter of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p1" ? "p2" : "p1",
        now: 0,
      });
    }
    state = apply(state, { type: "SUBMIT_GUESS", playerId: "p1", text: "walrus", matched: false });
    expect(state.round!.outcome).toBe("caught_wrong");
    for (const id of ["p2", "p3", "p4", "p5", "p6"]) {
      expect(state.players.find((p) => p.id === id)!.score).toBe(1);
    }
    expect(state.players.find((p) => p.id === "p0")!.score).toBe(0);
    expect(state.players.find((p) => p.id === "p1")!.score).toBe(0);
  });

  it("a tie acquits — fake survives without guessing", () => {
    let state = drawAll(dealtRound());
    const votes: Array<[string, string]> = [
      ["p1", "p2"], ["p2", "p1"], ["p3", "p2"], ["p4", "p1"], ["p5", "p6"], ["p6", "p5"],
    ];
    for (const [voter, target] of votes) {
      state = apply(state, { type: "CAST_VOTE", voterId: voter, targetId: target, now: 0 });
    }
    expect(state.phase).toBe("reveal");
    expect(state.round!.outcome).toBe("survived");
    expect(state.round!.accusedId).toBeNull();
    expect(state.players.find((p) => p.id === "p1")!.score).toBe(2);
  });

  it("accusing an innocent lets the fake survive", () => {
    let state = drawAll(dealtRound());
    for (const voter of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p2" ? "p3" : "p2",
        now: 0,
      });
    }
    expect(state.phase).toBe("reveal");
    expect(state.round!.outcome).toBe("survived");
    expect(state.round!.accusedId).toBe("p2");
  });

  it("guess timeout counts as a wrong guess, but not before the deadline", () => {
    let state = drawAll(dealtRound());
    for (const voter of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p1" ? "p2" : "p1",
        now: 0,
      });
    }
    expect(reduce(state, { type: "GUESS_TIMEOUT", now: 29_000 }).ok).toBe(false);
    state = apply(state, { type: "GUESS_TIMEOUT", now: 31_000 });
    expect(state.round!.outcome).toBe("caught_wrong");
  });
});

describe("full game", () => {
  it("plays N rounds then closes; play again resets scores but keeps fake rotation", () => {
    let state = lobbyWith(5);
    state = apply(state, { type: "SET_SETTINGS", settings: { rounds: 3, qmMode: "off" } });
    for (let round = 0; round < 3; round++) {
      const ids = state.players.map((p) => p.id);
      state = apply(state, {
        type: "START_ROUND",
        word: `word${round}`,
        category: "Objects",
        qmId: null,
        fakeId: pickFake(state, ids, () => 0),
        turnOrder: ids,
      });
      for (const id of ids) state = apply(state, { type: "MARK_SEEN", playerId: id, now: 0 });
      state = drawAll(state);
      const fake = state.round!.fakeId;
      for (const voter of ids) {
        if (voter === fake) {
          state = apply(state, { type: "CAST_VOTE", voterId: voter, targetId: ids.find((i) => i !== fake)!, now: 0 });
        } else {
          state = apply(state, { type: "CAST_VOTE", voterId: voter, targetId: fake, now: 0 });
        }
      }
      state = apply(state, { type: "SUBMIT_GUESS", playerId: fake, text: "nope", matched: false });
      if (round < 2) {
        state = apply(state, {
          type: "START_ROUND",
          word: `next${round}`,
          category: "Objects",
          qmId: null,
          fakeId: pickFake(state, ids, () => 0),
          turnOrder: ids,
        });
        // rewind: we only wanted to check it's allowed — go back via fresh clone
        state = { ...state }; // (state machine allows reveal → dealing)
        // undo for test flow: re-run reveal by voiding this accidental round
        state = apply(state, { type: "VOID_ROUND" });
      }
    }
    expect(state.roundsPlayed).toBe(3);
    state = apply(state, { type: "CLOSE_GAME" });
    expect(state.phase).toBe("closed");
    const counts = { ...state.fakeCounts };
    state = apply(state, { type: "PLAY_AGAIN" });
    expect(state.phase).toBe("lobby");
    expect(state.players.every((p) => p.score === 0)).toBe(true);
    expect(state.fakeCounts).toEqual(counts);
    expect(state.archive).toHaveLength(0);
  });

  it("fake duty rotates — nobody twice before everyone once", () => {
    const state = lobbyWith(5);
    const counts: Record<string, number> = { p0: 1, p1: 0, p2: 1, p3: 0, p4: 1 };
    const rigged = { ...state, fakeCounts: counts };
    for (let i = 0; i < 20; i++) {
      const fake = pickFake(rigged, ["p0", "p1", "p2", "p3", "p4"], Math.random);
      expect(["p1", "p3"]).toContain(fake);
    }
  });
});

describe("disconnects", () => {
  it("holds a seat on disconnect and pauses strokes", () => {
    let state = dealtRound();
    state = apply(state, { type: "SET_CONNECTED", playerId: "p3", connected: false, now: 1000 });
    expect(state.holds.p3).toBe(31_000);
    expect(reduce(state, { type: "COMMIT_STROKE", playerId: "p1", points: LINE, now: 0 }).ok).toBe(false);
    state = apply(state, { type: "SET_CONNECTED", playerId: "p3", connected: true, now: 5000 });
    expect(state.holds.p3).toBeUndefined();
    expect(reduce(state, { type: "COMMIT_STROKE", playerId: "p1", points: LINE, now: 0 }).ok).toBe(true);
  });

  it("tracks multiple held seats and releases only the returning seat", () => {
    let state = dealtRound();
    state = apply(state, {
      type: "SET_CONNECTED",
      playerId: "p3",
      connected: false,
      now: 1_000,
    });
    state = apply(state, {
      type: "SET_CONNECTED",
      playerId: "p4",
      connected: false,
      now: 2_000,
    });
    expect(Object.keys(state.holds).sort()).toEqual(["p3", "p4"]);

    state = apply(state, {
      type: "SET_CONNECTED",
      playerId: "p3",
      connected: true,
      now: 5_000,
    });
    expect(state.holds.p3).toBeUndefined();
    expect(state.holds.p4).toBe(32_000);
    expect(state.round!.droppedIds).toEqual([]);
  });

  it("dropping a player removes their remaining turns but keeps committed strokes", () => {
    let state = dealtRound();
    state = apply(state, { type: "COMMIT_STROKE", playerId: "p1", points: LINE, now: 0 });
    state = apply(state, { type: "COMMIT_STROKE", playerId: "p2", points: LINE, now: 0 });
    state = apply(state, { type: "DROP_PLAYER", playerId: "p2", now: 0 });
    expect(state.round!.strokes).toHaveLength(2);
    expect(state.round!.schedule.filter((id) => id === "p2")).toHaveLength(1); // only the taken turn
    state = drawAll(state);
    expect(state.phase).toBe("voting");
    expect(state.round!.strokes).toHaveLength(11); // 12 minus p2's second stroke
    expect(activeArtists(state.round!)).not.toContain("p2");
  });

  it("dropped players neither vote nor receive votes; their ballots reopen", () => {
    let state = drawAll(dealtRound());
    state = apply(state, { type: "CAST_VOTE", voterId: "p2", targetId: "p3", now: 0 });
    state = apply(state, { type: "CAST_VOTE", voterId: "p4", targetId: "p3", now: 0 });
    state = apply(state, { type: "DROP_PLAYER", playerId: "p3", now: 0 });
    expect(state.round!.votes.p2).toBeUndefined();
    expect(state.round!.votes.p4).toBeUndefined();
    // remaining voters: p1, p2, p4, p5, p6 — all vote p1 except p1
    for (const voter of ["p1", "p2", "p4", "p5", "p6"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p1" ? "p2" : "p1",
        now: 0,
      });
    }
    expect(state.phase).toBe("guessing");
  });

  it("dropping the fake artist is refused — the round must be voided instead", () => {
    let state = dealtRound();
    expect(reduce(state, { type: "DROP_PLAYER", playerId: "p1", now: 0 }).ok).toBe(false);
    state = apply(state, { type: "VOID_ROUND" });
    expect(state.round!.outcome).toBe("voided");
    expect(state.phase).toBe("reveal");
    expect(state.roundsPlayed).toBe(0); // voided rounds don't count
    expect(state.usedWords).toHaveLength(0); // the word goes back
    expect(state.fakeCounts.p1).toBe(0);
    expect(state.archive).toHaveLength(0);
    // re-deal is allowed from the voided reveal
    expect(
      reduce(state, {
        type: "START_ROUND",
        word: "octopus",
        category: "Animals",
        qmId: "p1",
        fakeId: "p2",
        turnOrder: ["p0", "p2", "p3", "p4", "p5", "p6"],
      }).ok,
    ).toBe(true);
  });

  it("votes don't resolve while a seat is held", () => {
    let state = drawAll(dealtRound());
    state = apply(state, { type: "SET_CONNECTED", playerId: "p6", connected: false, now: 0 });
    state = apply(state, { type: "DROP_PLAYER", playerId: "p6", now: 0 });
    for (const voter of ["p1", "p2", "p3", "p4"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p1" ? "p2" : "p1",
        now: 0,
      });
    }
    expect(state.phase).toBe("voting");
    state = apply(state, { type: "SET_CONNECTED", playerId: "p5", connected: false, now: 0 });
    state = apply(state, { type: "CAST_VOTE", voterId: "p5", targetId: "p1", now: 0 });
    expect(state.phase).toBe("voting"); // p5's ballot is in but their seat is held — no resolve
    // …and the reconnect releases the hold and resolves the completed ballot.
    state = apply(state, { type: "SET_CONNECTED", playerId: "p5", connected: true, now: 500 });
    expect(state.phase).toBe("guessing");
    expect(state.round!.accusedId).toBe("p1");
    expect(state.round!.guessDeadline).toBe(30_500);
  });
});

describe("vote tallying", () => {
  it("computes a unique leader or a tie", () => {
    const base = drawAll(dealtRound()).round!;
    expect(accusedFromVotes({ ...base, votes: { p2: "p1", p3: "p1", p4: "p5" } })).toBe("p1");
    expect(accusedFromVotes({ ...base, votes: { p2: "p1", p3: "p5" } })).toBeNull();
    expect(accusedFromVotes({ ...base, votes: {} })).toBeNull();
  });
});

describe("redaction", () => {
  it("hides the word from the fake and everyone's ballots until resolved", () => {
    const state = dealtRound();
    const fakeView = redactState(state, "p1");
    expect(fakeView.you.role).toBe("fake");
    expect(fakeView.you.word).toBeNull();
    expect(fakeView.state.round!.word).toBeNull();
    expect(fakeView.state.round!.fakeId).toBeNull();
    const artistView = redactState(state, "p2");
    expect(artistView.you.role).toBe("artist");
    expect(artistView.you.word).toBe("penguin");
    expect(artistView.state.round!.word).toBeNull(); // never in the shared state pre-reveal
    const qmView = redactState(state, "p0");
    expect(qmView.you.role).toBe("qm");
    expect(qmView.you.word).toBe("penguin");
    expect((qmView.state as unknown as Record<string, unknown>).usedWords).toBeUndefined();
    expect((qmView.state as unknown as Record<string, unknown>).fakeCounts).toBeUndefined();
  });

  it("reveals everything at the reveal", () => {
    let state = drawAll(dealtRound());
    for (const voter of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p1" ? "p2" : "p1",
        now: 0,
      });
    }
    const during = redactState(state, "p2");
    expect(during.state.phase).toBe("guessing");
    expect(during.state.round!.fakeId).toBe("p1"); // the vote outed them
    expect(during.state.round!.word).toBeNull(); // but the word stays hidden
    state = apply(state, { type: "SUBMIT_GUESS", playerId: "p1", text: "seal", matched: false });
    const after = redactState(state, "p1");
    expect(after.state.round!.word).toBe("penguin");
    expect(after.state.round!.votes).not.toBeNull();
    expect(after.state.round!.guess).toBe("seal");
  });
});

describe("fuzzy matching", () => {
  it("forgives plurals and a letter's slip", () => {
    expect(guessMatches("penguin", "penguin")).toBe(true);
    expect(guessMatches("Penguins", "penguin")).toBe(true);
    expect(guessMatches("penquin", "penguin")).toBe(true);
    expect(guessMatches("pengiun", "penguin")).toBe(false); // two slips on a short word
    expect(guessMatches("PENGUIN ", "penguin")).toBe(true);
    expect(guessMatches("berries", "berry")).toBe(true);
    expect(guessMatches("walrus", "penguin")).toBe(false);
    expect(guessMatches("", "penguin")).toBe(false);
  });

  it("handles movie titles with articles, spacing and punctuation", () => {
    expect(guessMatches("finding nemo", "Finding Nemo")).toBe(true);
    expect(guessMatches("The Titanic", "Titanic")).toBe(true);
    expect(guessMatches("findingnemo", "Finding Nemo")).toBe(true);
    expect(guessMatches("finding memo", "Finding Nemo")).toBe(true); // one slip, long word
    expect(guessMatches("jaws 2", "Jaws")).toBe(false);
  });
});

describe("room codes", () => {
  it("generates 4 safe uppercase letters", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(isValidRoomCode(code)).toBe(true);
      expect(code).not.toMatch(/[ILOQ]/);
    }
    expect(normalizeRoomCode("mo-lt!")).toBe("MOLT");
    expect(isValidRoomCode("MOLT")).toBe(true);
    expect(isValidRoomCode("MO1T")).toBe(false);
  });
});

describe("review regressions", () => {
  it("QM dropped before dealing pushes the cards out instead of deadlocking", () => {
    let state = startedRound(); // dealing, dealt=false, QM p0
    state = apply(state, { type: "SET_CONNECTED", playerId: "p0", connected: false, now: 0 });
    state = apply(state, { type: "DROP_PLAYER", playerId: "p0", now: 0 });
    expect(state.round!.qmId).toBeNull();
    expect(state.round!.dealt).toBe(true); // cards go out without the QM
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      state = apply(state, { type: "MARK_SEEN", playerId: id, now: 0 });
    }
    expect(state.phase).toBe("drawing");
  });

  it("absent players sit rounds out — a smaller-than-roster turn order is legal", () => {
    let state = lobbyWith(7);
    state = apply(state, { type: "SET_CONNECTED", playerId: "p6", connected: false, now: 0 });
    state = apply(state, {
      type: "START_ROUND",
      word: "owl",
      category: "Animals",
      qmId: "p0",
      fakeId: "p1",
      turnOrder: ["p1", "p2", "p3", "p4", "p5"], // p6 sits out
    });
    expect(state.phase).toBe("dealing");
    expect(state.round!.schedule).toHaveLength(10);
  });

  it("a spectator not in the round disconnecting does not pause the game", () => {
    let state = lobbyWith(6);
    state = apply(state, {
      type: "START_ROUND",
      word: "owl",
      category: "Animals",
      qmId: null,
      fakeId: "p1",
      turnOrder: ["p0", "p1", "p2", "p3", "p4"], // p5 sits out
    });
    state = apply(state, { type: "SET_CONNECTED", playerId: "p5", connected: false, now: 0 });
    expect(state.holds).toEqual({});
  });

  it("host duty passes to a live seat at the reveal", () => {
    let state = drawAll(dealtRound());
    for (const voter of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p1" ? "p2" : "p1",
        now: 0,
      });
    }
    state = apply(state, { type: "SUBMIT_GUESS", playerId: "p1", text: "x", matched: false });
    expect(state.phase).toBe("reveal");
    state = apply(state, { type: "SET_CONNECTED", playerId: "p0", connected: false, now: 0 });
    expect(state.hostId).not.toBe("p0");
  });

  it("EXTEND_GUESS restarts the fake's clock", () => {
    let state = drawAll(dealtRound());
    for (const voter of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p1" ? "p2" : "p1",
        now: 0,
      });
    }
    expect(state.round!.guessDeadline).toBe(30_000);
    state = apply(state, { type: "EXTEND_GUESS", now: 20_000 });
    expect(state.round!.guessDeadline).toBe(50_000);
  });

  it("emptying the lobby clears the host so the next joiner claims it", () => {
    let state = lobbyWith(2);
    state = apply(state, { type: "REMOVE_PLAYER", playerId: "p1" });
    state = apply(state, { type: "REMOVE_PLAYER", playerId: "p0" });
    expect(state.hostId).toBe("");
    state = apply(state, {
      type: "ADD_PLAYER",
      player: { id: "fresh", name: "Fresh", colorIndex: 0 },
    });
    expect(state.hostId).toBe("fresh");
  });

  it("rejects out-of-range colours and oversized strokes", () => {
    const state = lobbyWith(5);
    expect(reduce(state, { type: "ADD_PLAYER", player: { id: "x", name: "X", colorIndex: 99 } }).ok).toBe(false);
    expect(reduce(state, { type: "ADD_PLAYER", player: { id: "x", name: "X", colorIndex: -1 } }).ok).toBe(false);
    const playing = dealtRound();
    const huge = Array.from({ length: 3000 }, () => 0.5);
    expect(reduce(playing, { type: "COMMIT_STROKE", playerId: "p1", points: huge, now: 0 }).ok).toBe(false);
  });

  it("voiding a round rewinds the QM rotation", () => {
    let state = startedRound();
    expect(state.qmIndex).toBe(1);
    state = apply(state, { type: "VOID_ROUND" });
    expect(state.qmIndex).toBe(0);
  });
});

describe("round preparation", () => {
  it("shuffles the drawing order each round from connected non-QM players", async () => {
    const { prepareRoundEvent } = await import("../shared/decks");
    let state = lobbyWith(7);
    state = apply(state, { type: "SET_CONNECTED", playerId: "p6", connected: false, now: 0 });
    const orders = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const event = prepareRoundEvent(state);
      if (event.type !== "START_ROUND") throw new Error("expected START_ROUND");
      // Always a permutation of the connected, non-QM roster…
      const expected = state.players
        .filter((p) => p.connected && p.id !== event.qmId)
        .map((p) => p.id)
        .sort();
      expect([...event.turnOrder].sort()).toEqual(expected);
      expect(event.turnOrder).not.toContain("p6");
      expect(event.turnOrder).toContain(event.fakeId);
      orders.add(event.turnOrder.join(","));
    }
    // …and not the same order every time.
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("stroke clock", () => {
  function clockedRound(): RoomState {
    let state = lobbyWith(5);
    state = apply(state, {
      type: "SET_SETTINGS",
      settings: { qmMode: "off", strokeClock: 60 },
    });
    state = apply(state, {
      type: "START_ROUND",
      word: "owl",
      category: "Animals",
      qmId: null,
      fakeId: "p1",
      turnOrder: ["p0", "p1", "p2", "p3", "p4"],
    });
    for (const id of ["p0", "p1", "p2", "p3", "p4"]) {
      state = apply(state, { type: "MARK_SEEN", playerId: id, now: 100_000 });
    }
    return state;
  }

  it("arms when drawing starts and re-arms per turn", () => {
    let state = clockedRound();
    expect(state.phase).toBe("drawing");
    expect(state.round!.turnDeadline).toBe(160_000);
    state = apply(state, { type: "COMMIT_STROKE", playerId: "p0", points: LINE, now: 130_000 });
    expect(state.round!.turnDeadline).toBe(190_000);
  });

  it("forfeits an idle turn on timeout, but never early", () => {
    let state = clockedRound();
    expect(reduce(state, { type: "TURN_TIMEOUT", now: 159_000 }).ok).toBe(false);
    state = apply(state, { type: "TURN_TIMEOUT", now: 161_000 });
    expect(state.round!.turnIndex).toBe(1);
    expect(state.round!.strokes).toHaveLength(0); // no stroke for the forfeited pass
    expect(currentDrawerId(state)).toBe("p1");
    expect(state.round!.turnDeadline).toBe(221_000);
  });

  it("gives the ballot a doubled clock and force-resolves with cast votes", () => {
    let state = clockedRound();
    while (state.phase === "drawing") {
      state = apply(state, {
        type: "COMMIT_STROKE",
        playerId: currentDrawerId(state)!,
        points: LINE,
        now: 200_000,
      });
    }
    expect(state.phase).toBe("voting");
    expect(state.round!.turnDeadline).toBe(200_000 + 120_000);
    state = apply(state, { type: "CAST_VOTE", voterId: "p0", targetId: "p1", now: 210_000 });
    state = apply(state, { type: "CAST_VOTE", voterId: "p2", targetId: "p1", now: 211_000 });
    state = apply(state, { type: "TURN_TIMEOUT", now: 320_001 });
    expect(state.phase).toBe("guessing"); // 2 votes, both on the fake
    expect(state.round!.accusedId).toBe("p1");
  });

  it("stays off when strokeClock is 0 and pauses freeze it", () => {
    let base = dealtRound(); // default settings: clock off
    expect(base.round!.turnDeadline).toBeNull();
    let state = clockedRound();
    state = apply(state, { type: "SET_CONNECTED", playerId: "p3", connected: false, now: 120_000 });
    expect(reduce(state, { type: "TURN_TIMEOUT", now: 500_000 }).ok).toBe(false); // paused
    state = apply(state, { type: "SET_CONNECTED", playerId: "p3", connected: true, now: 400_000 });
    expect(state.round!.turnDeadline).toBe(410_000); // pause gave time back
  });
});

describe("passes and win mode", () => {
  it("builds the schedule from the passes setting", () => {
    let state = lobbyWith(5);
    state = apply(state, { type: "SET_SETTINGS", settings: { qmMode: "off", passes: 3 } });
    state = apply(state, {
      type: "START_ROUND",
      word: "owl",
      category: "Animals",
      qmId: null,
      fakeId: "p1",
      turnOrder: ["p0", "p1", "p2", "p3", "p4"],
    });
    expect(state.round!.schedule).toHaveLength(15);
  });

  it("score mode closes at 10+ points but not before three rounds", async () => {
    const { isGameOver } = await import("../shared/engine");
    let state = lobbyWith(5);
    state = apply(state, { type: "SET_SETTINGS", settings: { winMode: "score10" } });
    state.players[0].score = 12;
    state.roundsPlayed = 2;
    expect(isGameOver(state)).toBe(false);
    state.roundsPlayed = 3;
    expect(isGameOver(state)).toBe(true);
    state.players[0].score = 9;
    expect(isGameOver(state)).toBe(false);
  });
});

describe("house deck", () => {
  it("collects deduped words with authors, capped and lobby-only", () => {
    let state = lobbyWith(5);
    state = apply(state, { type: "ADD_HOUSE_WORDS", playerId: "p0", words: ["Kite", " kite ", "x", "windmill"] });
    expect(state.customWords).toEqual([
      { word: "Kite", authorId: "p0" },
      { word: "windmill", authorId: "p0" },
    ]);
    state = apply(state, { type: "REMOVE_HOUSE_WORD", playerId: "p0", word: "Kite" });
    expect(state.customWords).toHaveLength(1);
    // someone else can't remove your word
    state = apply(state, { type: "ADD_HOUSE_WORDS", playerId: "p1", words: ["lantern"] });
    state = apply(state, { type: "REMOVE_HOUSE_WORD", playerId: "p0", word: "lantern" });
    expect(state.customWords.map((w) => w.word)).toContain("lantern");
  });

  it("refuses to start on a thin house deck", () => {
    let state = lobbyWith(5);
    state = apply(state, { type: "SET_SETTINGS", settings: { deckId: "house", qmMode: "off" } });
    state = apply(state, { type: "ADD_HOUSE_WORDS", playerId: "p0", words: ["kite", "windmill"] });
    expect(
      reduce(state, {
        type: "START_ROUND",
        word: "kite",
        category: "House deck",
        qmId: null,
        fakeId: "p1",
        turnOrder: ["p0", "p1", "p2", "p3", "p4"],
      }).ok,
    ).toBe(false);
  });

  it("never hands the fake a word they authored", async () => {
    const { prepareRoundEvent } = await import("../shared/decks");
    let state = lobbyWith(5);
    state = apply(state, { type: "SET_SETTINGS", settings: { deckId: "house", qmMode: "off" } });
    // p0 writes 12 words; everyone else writes one each
    state = apply(state, {
      type: "ADD_HOUSE_WORDS",
      playerId: "p0",
      words: Array.from({ length: 12 }, (_, i) => `p0word${i}`),
    });
    for (const id of ["p1", "p2", "p3", "p4"]) {
      state = apply(state, { type: "ADD_HOUSE_WORDS", playerId: id, words: [`${id}word`] });
    }
    for (let i = 0; i < 60; i++) {
      const event = prepareRoundEvent(state);
      if (event.type !== "START_ROUND") throw new Error("expected START_ROUND");
      const author = state.customWords.find((w) => w.word === event.word)?.authorId;
      expect(author).toBeDefined();
      expect(author).not.toBe(event.fakeId);
    }
  });

  it("redacts house words down to a count, except your own", () => {
    let state = lobbyWith(5);
    state = apply(state, { type: "ADD_HOUSE_WORDS", playerId: "p0", words: ["kite", "windmill"] });
    state = apply(state, { type: "ADD_HOUSE_WORDS", playerId: "p1", words: ["lantern"] });
    const view = redactState(state, "p1");
    expect((view.state as unknown as Record<string, unknown>).customWords).toBeUndefined();
    expect(view.state.houseWordCount).toBe(3);
    expect(view.you.houseWords).toEqual(["lantern"]);
  });
});

describe("migration", () => {
  it("normalizes states persisted before the new fields existed", async () => {
    const { normalizeRoom } = await import("../shared/engine");
    const old = createRoom({ code: "MOLT", mode: "online", hostId: "" }) as unknown as Record<string, unknown>;
    delete old.customWords;
    (old.settings as Record<string, unknown>).passes = undefined;
    delete (old.settings as Record<string, unknown>).strokeClock;
    delete (old.settings as Record<string, unknown>).winMode;
    const fixed = normalizeRoom(old as unknown as RoomState);
    expect(fixed.customWords).toEqual([]);
    expect(fixed.settings.passes).toBe(2);
    expect(fixed.settings.strokeClock).toBe(0);
    expect(fixed.settings.winMode).toBe("rounds");
  });
});

describe("turn-style options", () => {
  function optRound(settings: Record<string, unknown>): RoomState {
    let state = lobbyWith(5);
    state = apply(state, {
      type: "SET_SETTINGS",
      settings: { qmMode: "off", ...settings },
    });
    state = apply(state, {
      type: "START_ROUND",
      word: "owl",
      category: "Animals",
      qmId: null,
      fakeId: "p1",
      turnOrder: ["p0", "p1", "p2", "p3", "p4"],
    });
    for (const id of ["p0", "p1", "p2", "p3", "p4"]) {
      state = apply(state, { type: "MARK_SEEN", playerId: id, now: 0 });
    }
    return state;
  }

  it("one-line rooms refuse segmented strokes; free-ink rooms accept them", () => {
    const line = optRound({});
    const seg: GameEvent = { type: "COMMIT_STROKE", playerId: "p0", points: [0.1, 0.1, 0.2, 0.2, 0.5, 0.5, 0.6, 0.6], breaks: [2], now: 0 };
    expect(reduce(line, seg).ok).toBe(false);
    let free = optRound({ penMode: "free" });
    free = apply(free, seg);
    expect(free.round!.strokes[0].breaks).toEqual([2]);
  });

  it("rejects incoherent segment breaks", () => {
    const free = optRound({ penMode: "free" });
    for (const breaks of [[1], [3], [4], [2, 2], [-1]]) {
      expect(
        reduce(free, {
          type: "COMMIT_STROKE",
          playerId: "p0",
          points: [0.1, 0.1, 0.2, 0.2, 0.5, 0.5, 0.6, 0.6],
          breaks,
          now: 0,
        }).ok,
      ).toBe(false);
    }
  });

  it("enforces the ink budget server-side", () => {
    const short = optRound({ inkLimit: 60 });
    // A stroke the full width of the canvas — 1.0 > 0.6 budget.
    expect(
      reduce(short, { type: "COMMIT_STROKE", playerId: "p0", points: [0, 0.5, 0.5, 0.5, 1, 0.5], now: 0 }).ok,
    ).toBe(false);
    const ok = apply(short, {
      type: "COMMIT_STROKE",
      playerId: "p0",
      points: [0.2, 0.5, 0.4, 0.5, 0.5, 0.5],
      now: 0,
    });
    expect(ok.round!.strokes).toHaveLength(1);
  });

  it("relaxed rooms never hold a seat — the game just waits", () => {
    let state = optRound({ presence: "relaxed" });
    state = apply(state, { type: "SET_CONNECTED", playerId: "p2", connected: false, now: 0 });
    expect(state.holds).toEqual({});
    // strokes keep flowing (no pause)
    expect(
      reduce(state, { type: "COMMIT_STROKE", playerId: "p0", points: LINE, now: 0 }).ok,
    ).toBe(true);
    // the host can still drop the missing player without any hold
    const dropped = apply(state, { type: "DROP_PLAYER", playerId: "p2", now: 0 });
    expect(dropped.round!.droppedIds).toContain("p2");
  });
});

describe("seat holds do not outlive their round", () => {
  /** Caught fake, then a bystander closes their tab while the fake guesses. */
  function heldDuringGuess(): RoomState {
    let state = drawAll(dealtRound());
    expect(state.phase).toBe("voting");
    for (const voter of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      state = apply(state, {
        type: "CAST_VOTE",
        voterId: voter,
        targetId: voter === "p1" ? "p2" : "p1",
        now: 0,
      });
    }
    expect(state.phase).toBe("guessing");
    state = apply(state, { type: "SET_CONNECTED", playerId: "p5", connected: false, now: 1_000 });
    expect(state.holds.p5).toBeGreaterThan(0);
    return state;
  }

  it("releases the hold when the round is scored", () => {
    const state = apply(heldDuringGuess(), {
      type: "SUBMIT_GUESS",
      playerId: "p1",
      text: "seal",
      matched: false,
    });
    expect(state.phase).toBe("reveal");
    expect(state.holds).toEqual({});
  });

  it("releases the hold when the round is voided", () => {
    const state = apply(heldDuringGuess(), { type: "VOID_ROUND" });
    expect(state.holds).toEqual({});
  });

  it("does not pause the next round on behalf of an absent player", () => {
    let state = apply(heldDuringGuess(), {
      type: "SUBMIT_GUESS",
      playerId: "p1",
      text: "seal",
      matched: false,
    });
    // p5 is still away, so they sit the next round out entirely.
    state = apply(state, {
      type: "START_ROUND",
      word: "otter",
      category: "Animals",
      qmId: "p0",
      fakeId: "p2",
      turnOrder: ["p1", "p2", "p3", "p4", "p6"],
    });
    state = apply(state, { type: "DEAL", now: 2_000 });
    for (const id of ["p0", "p1", "p2", "p3", "p4", "p6"]) {
      state = apply(state, { type: "MARK_SEEN", playerId: id, now: 2_000 });
    }
    expect(state.phase).toBe("drawing");
    // The round must be playable immediately — not frozen behind a stale hold.
    expect(
      reduce(state, {
        type: "COMMIT_STROKE",
        playerId: currentDrawerId(state)!,
        points: LINE,
        now: 2_000,
      }).ok,
    ).toBe(true);
  });
});

describe("house deck fairness", () => {
  /** prepareRoundEvent is typed as GameEvent; narrow it to the round it builds. */
  function startEvent(state: RoomState, rng: () => number) {
    const event = prepareRoundEvent(state, rng);
    if (event.type !== "START_ROUND") throw new Error(`Expected START_ROUND, got ${event.type}`);
    return event;
  }

  /** Everyone writes "pizza"; p0..p4 also pad the pot to the minimum. */
  function sharedWordLobby(): RoomState {
    let state = lobbyWith(5);
    state = apply(state, { type: "SET_SETTINGS", settings: { deckId: "house", qmMode: "off" } });
    for (let i = 0; i < 5; i++) {
      state = apply(state, { type: "ADD_HOUSE_WORDS", playerId: `p${i}`, words: ["pizza"] });
    }
    state = apply(state, {
      type: "ADD_HOUSE_WORDS",
      playerId: "p0",
      words: ["kite", "ladder", "compass", "anchor", "violin", "cactus", "lantern"],
    });
    return state;
  }

  it("never deals the fake a word they wrote, even when others wrote it too", () => {
    const state = sharedWordLobby();
    expect(state.customWords.filter((w) => w.word === "pizza")).toHaveLength(5);
    // Sweep the whole rng range rather than sampling — the bug was probabilistic.
    for (let i = 0; i < 200; i++) {
      const event = startEvent(state, () => i / 200);
      const authors = state.customWords
        .filter((w) => w.word.toLowerCase() === event.word.toLowerCase())
        .map((w) => w.authorId);
      expect(authors).not.toContain(event.fakeId);
    }
  });

  it("borrows from the built-in decks rather than deal the fake their own word", () => {
    // p0 writes the entire pot, so whenever p0 is the fake nothing in the
    // house deck is eligible and the round has to fall back.
    let state = lobbyWith(5);
    state = apply(state, { type: "SET_SETTINGS", settings: { deckId: "house", qmMode: "off" } });
    const pot = [
      "kite", "ladder", "compass", "anchor", "violin", "cactus",
      "lantern", "pizza", "harbour", "puppet", "cellar", "trumpet",
    ];
    state = apply(state, { type: "ADD_HOUSE_WORDS", playerId: "p0", words: pot });

    let fellBack = 0;
    for (let i = 0; i < 200; i++) {
      const event = startEvent(state, () => i / 200);
      if (event.fakeId !== "p0") continue;
      fellBack += 1;
      expect(event.category).not.toBe("House deck");
      expect(pot).not.toContain(event.word.toLowerCase());
    }
    expect(fellBack).toBeGreaterThan(0);
  });
});

describe("host room lock", () => {
  it("refuses newcomers while locked and lets them in again after", () => {
    let state = lobbyWith(5);
    state = apply(state, { type: "SET_LOCKED", locked: true });
    expect(state.locked).toBe(true);
    expect(
      expectFail(state, {
        type: "ADD_PLAYER",
        player: { id: "x", name: "Stranger", colorIndex: 7 },
      }),
    ).toMatch(/locked/i);

    state = apply(state, { type: "SET_LOCKED", locked: false });
    state = apply(state, {
      type: "ADD_PLAYER",
      player: { id: "x", name: "Stranger", colorIndex: 7 },
    });
    expect(state.players).toHaveLength(6);
  });

  it("can be thrown mid-game, and survives a reload", () => {
    // The point is to shut a room that is already playing, so it must not be
    // a lobby-only control.
    let state = drawAll(dealtRound());
    state = apply(state, { type: "SET_LOCKED", locked: true });
    expect(state.locked).toBe(true);
    const { locked: _dropped, ...older } = state;
    expect(normalizeRoom(older as typeof state).locked).toBe(false);
  });
});

describe("critic guess matching", () => {
  // Luna answers in her own voice. The human fake artist types an answer and
  // either has it or does not, so the two comparisons are deliberately not
  // the same function.
  it("accepts the word inside a short phrase", () => {
    for (const guess of ["a barbie doll", "Barbie", "some kind of barbie", "barbies"]) {
      expect(criticGuessMatches(guess, "Barbie"), guess).toBe(true);
    }
  });

  it("matches a multi-word answer as a run of words", () => {
    expect(criticGuessMatches("a sleeping beauty scene", "Sleeping Beauty")).toBe(true);
    expect(criticGuessMatches("sleeping", "Sleeping Beauty")).toBe(false);
    expect(criticGuessMatches("beauty asleep", "Sleeping Beauty")).toBe(false);
  });

  it("does not match a word buried inside a longer one", () => {
    expect(criticGuessMatches("a cartoon", "art")).toBe(false);
    expect(criticGuessMatches("a housecoat", "house")).toBe(false);
  });

  it("still rejects an honest miss", () => {
    expect(criticGuessMatches("a horse beside a table", "Sleeping Beauty")).toBe(false);
    expect(criticGuessMatches("", "Barbie")).toBe(false);
  });

  it("leaves the human matcher strict", () => {
    // The fake artist naming the word inside a sentence must not count, or
    // "is it a house or a barn?" would steal the round.
    expect(guessMatches("a barbie doll", "Barbie")).toBe(false);
    expect(guessMatches("Barbie", "Barbie")).toBe(true);
  });
});
