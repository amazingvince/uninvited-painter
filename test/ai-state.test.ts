import { describe, expect, it } from "vitest";
import { aiEnabled, createRoom, currentDrawerId, normalizeRoom, reduce } from "../shared/engine";
import type { CriticVerdict, GameEvent, RoomState, Settings } from "../shared/types";
import { redactState } from "../shared/protocol";
import {
  buildOnlineAiForm,
  localAiRequestMeta,
  shouldPollLocalAi,
  shouldStartLocalAi,
} from "../src/lib/postRoundAi";
import { criticViewModel } from "../src/screens/CriticVerdict";
import { renditionImageUrl } from "../src/screens/RenditionReveal";

const JOB_ID = "00000000-0000-4000-8000-000000000001";

function sampleVerdict(overrides: Partial<CriticVerdict> = {}): CriticVerdict {
  return {
    title: "Untitled Emergency",
    subjectGuess: "an anxious bird",
    confidence: 73,
    rating: 7,
    ratingTag: "Structurally optimistic",
    review: "A brave collision of feathers and municipal planning.",
    callout: { playerId: "p2", text: "The blue line has filed for independence." },
    detective: { playerId: "p0", reason: "Red knew too little and drew too much." },
    ...overrides,
  };
}

function apply(state: RoomState, event: GameEvent): RoomState {
  const result = reduce(state, event);
  if (!result.ok) throw new Error(`${event.type}: ${result.error}`);
  return result.state;
}

function votingRoom(settings: Partial<Settings> = {}): RoomState {
  let state = createRoom({
    code: "MOLT",
    mode: "online",
    hostId: "",
    settings: { qmMode: "off", passes: 1, ...settings },
  });
  for (let i = 0; i < 5; i++) {
    state = apply(state, {
      type: "ADD_PLAYER",
      player: { id: `p${i}`, name: `Player ${i}`, colorIndex: i },
    });
  }
  state = apply(state, {
    type: "START_ROUND",
    word: "penguin",
    category: "Animals",
    qmId: null,
    fakeId: "p0",
    turnOrder: ["p0", "p1", "p2", "p3", "p4"],
  });
  for (let i = 0; i < 5; i++) {
    state = apply(state, { type: "MARK_SEEN", playerId: `p${i}`, now: 0 });
  }
  while (state.phase === "drawing") {
    state = apply(state, {
      type: "COMMIT_STROKE",
      playerId: currentDrawerId(state)!,
      points: [0.1, 0.1, 0.5, 0.5, 0.9, 0.9],
      now: 0,
    });
  }
  return state;
}

function revealedRoomWithPendingAi(): RoomState {
  let state = apply(
    votingRoom({ aiDetective: true }),
    { type: "START_ROUND_AI", roundNo: 1, jobId: JOB_ID },
  );
  const votes: Array<[string, string]> = [
    ["p0", "p1"],
    ["p1", "p2"],
    ["p2", "p1"],
    ["p3", "p1"],
    ["p4", "p1"],
  ];
  for (const [voterId, targetId] of votes) {
    state = apply(state, { type: "CAST_VOTE", voterId, targetId, now: 0 });
  }
  expect(state.phase).toBe("reveal");
  return state;
}

describe("post-round AI state", () => {
  it("decides when local AI starts and polling continues", () => {
    const voting = votingRoom();
    expect(shouldStartLocalAi(voting)).toBe(true);
    const pending = apply(voting, {
      type: "START_ROUND_AI",
      roundNo: 1,
      jobId: JOB_ID,
    });
    expect(shouldStartLocalAi(pending)).toBe(false);
    expect(shouldPollLocalAi(pending.round!.ai)).toBe(true);
    expect(
      shouldPollLocalAi({
        ...pending.round!.ai,
        criticStatus: "ready",
        renditionStatus: "unavailable",
      }),
    ).toBe(false);
  });

  it("builds bounded local metadata and a secret-free online upload", () => {
    const voting = votingRoom({ aiDetective: true, aiTone: "absurd" });
    const meta = localAiRequestMeta(voting, JOB_ID);
    expect(meta).toMatchObject({
      jobId: JOB_ID,
      roundNo: 1,
      word: "penguin",
      aiCritic: true,
      aiDetective: true,
      aiTone: "absurd",
    });
    expect(meta.artists).toEqual([
      { id: "p0", colorIndex: 0 },
      { id: "p1", colorIndex: 1 },
      { id: "p2", colorIndex: 2 },
      { id: "p3", colorIndex: 3 },
      { id: "p4", colorIndex: 4 },
    ]);

    const form = buildOnlineAiForm(
      "seat-token",
      1,
      new Blob(["png"], { type: "image/png" }),
    );
    expect([...form.keys()].sort()).toEqual(["image", "roundNo", "token"]);
    expect(form.get("token")).toBe("seat-token");
    expect(form.get("roundNo")).toBe("1");
    const serialized = JSON.stringify([...form.entries()]);
    expect(serialized).not.toContain("penguin");
    expect(serialized).not.toContain("Player");
    expect(serialized).not.toContain("aiTone");
    expect(serialized).not.toContain("fakeId");
  });

  it("builds named, explicitly non-scoring Luna view models", () => {
    const revealed = revealedRoomWithPendingAi();
    const ready = apply(revealed, {
      type: "RESOLVE_ROUND_CRITIC",
      roundNo: 1,
      jobId: JOB_ID,
      verdict: sampleVerdict({
        subjectGuess: "penguin",
        callout: { playerId: "p2", text: "Blue understood the assignment." },
        detective: { playerId: "p0", reason: "Red drew around the truth." },
      }),
    });
    const view = criticViewModel(ready.round!, ready.players);
    expect(view).toMatchObject({
      status: "ready",
      calloutName: "Player 2",
      detectiveName: "Player 0",
      subjectMatched: true,
      detectiveMatched: true,
      detectiveCounts: false,
    });

    const wrong = criticViewModel(
      {
        ...ready.round!,
        ai: {
          ...ready.round!.ai,
          critic: sampleVerdict({
            subjectGuess: "municipal toaster",
            detective: { playerId: "p3", reason: "Green seemed evasive." },
          }),
        },
      },
      ready.players.filter((player) => player.id !== "p3"),
    );
    expect(wrong.subjectMatched).toBe(false);
    expect(wrong.detectiveMatched).toBe(false);
    expect(wrong.detectiveName).toBe("A departed artist");
  });

  it("models pending, unavailable, disabled, and rendition URLs", () => {
    const pending = revealedRoomWithPendingAi();
    expect(criticViewModel(pending.round!, pending.players).status).toBe(
      "pending",
    );
    expect(
      criticViewModel(
        {
          ...pending.round!,
          ai: {
            ...pending.round!.ai,
            criticStatus: "unavailable",
          },
        },
        pending.players,
      ).status,
    ).toBe("unavailable");
    expect(
      criticViewModel(
        {
          ...pending.round!,
          ai: {
            jobId: null,
            criticStatus: "idle",
            critic: null,
            renditionStatus: "idle",
            renditionId: null,
          },
        },
        pending.players,
      ).status,
    ).toBe("idle");
    expect(renditionImageUrl(JOB_ID)).toBe(
      `/api/ai/renditions/${JOB_ID}`,
    );
  });

  it("defaults and normalizes AI settings", () => {
    const room = createRoom({ code: "", mode: "local", hostId: "" });
    expect(room.settings).toMatchObject({
      aiCritic: true,
      aiDetective: false,
      aiTone: "witty",
    });

    delete (room.settings as Partial<Settings> & Record<string, unknown>).aiCritic;
    delete (room.settings as Partial<Settings> & Record<string, unknown>).aiDetective;
    delete (room.settings as Partial<Settings> & Record<string, unknown>).aiTone;

    expect(normalizeRoom(room).settings).toMatchObject({
      aiCritic: true,
      aiDetective: false,
      aiTone: "witty",
    });
  });

  it("rejects invalid AI tones", () => {
    const room = createRoom({ code: "", mode: "local", hostId: "" });
    const result = reduce(room, {
      type: "SET_SETTINGS",
      settings: { aiTone: "mean" as Settings["aiTone"] },
    });
    expect(result).toEqual({ ok: false, error: "Bad AI tone" });
  });

  it("enables the post-round job when either AI feature is on", () => {
    expect(aiEnabled({ aiCritic: false, aiDetective: false })).toBe(false);
    expect(aiEnabled({ aiCritic: true, aiDetective: false })).toBe(true);
    expect(aiEnabled({ aiCritic: false, aiDetective: true })).toBe(true);
  });

  it("initializes a round with idle AI branches", () => {
    const state = votingRoom();
    expect(state.round?.ai).toEqual({
      jobId: null,
      criticStatus: "idle",
      critic: null,
      renditionStatus: "idle",
      renditionId: null,
    });
  });

  it("starts only one AI job after drawing closes", () => {
    const voting = votingRoom();
    const jobId = JOB_ID;
    const pending = apply(
      voting,
      { type: "START_ROUND_AI", roundNo: 1, jobId } as GameEvent,
    );
    expect(pending.round?.ai).toEqual({
      jobId,
      criticStatus: "pending",
      critic: null,
      renditionStatus: "pending",
      renditionId: null,
    });

    const duplicate = reduce(
      pending,
      {
        type: "START_ROUND_AI",
        roundNo: 1,
        jobId: "00000000-0000-4000-8000-000000000002",
      } as GameEvent,
    );
    expect(duplicate).toEqual({ ok: false, error: "AI job already started" });
  });

  it("resolves critic and rendition branches independently", () => {
    const pending = apply(
      votingRoom({ aiDetective: true }),
      { type: "START_ROUND_AI", roundNo: 1, jobId: JOB_ID } as GameEvent,
    );
    const criticReady = apply(
      pending,
      {
        type: "RESOLVE_ROUND_CRITIC",
        roundNo: 1,
        jobId: JOB_ID,
        verdict: sampleVerdict(),
      } as GameEvent,
    );
    expect(criticReady.round?.ai).toMatchObject({
      criticStatus: "ready",
      renditionStatus: "pending",
      critic: { title: "Untitled Emergency", rating: 7 },
    });

    const allReady = apply(
      criticReady,
      {
        type: "RESOLVE_ROUND_RENDITION",
        roundNo: 1,
        jobId: JOB_ID,
        renditionId: JOB_ID,
      } as GameEvent,
    );
    expect(allReady.round?.ai).toMatchObject({
      criticStatus: "ready",
      renditionStatus: "ready",
      renditionId: JOB_ID,
    });
  });

  it("rejects malformed verdicts and stale job results", () => {
    const pending = apply(
      votingRoom({ aiDetective: true }),
      { type: "START_ROUND_AI", roundNo: 1, jobId: JOB_ID } as GameEvent,
    );
    expect(
      reduce(
        pending,
        {
          type: "RESOLVE_ROUND_CRITIC",
          roundNo: 1,
          jobId: JOB_ID,
          verdict: sampleVerdict({ rating: 11 }),
        } as GameEvent,
      ),
    ).toEqual({ ok: false, error: "Bad critic rating" });
    expect(
      reduce(
        pending,
        {
          type: "RESOLVE_ROUND_RENDITION",
          roundNo: 1,
          jobId: "00000000-0000-4000-8000-000000000002",
          renditionId: JOB_ID,
        } as GameEvent,
      ),
    ).toEqual({ ok: false, error: "Stale AI job" });
  });

  it("copies pending AI into the archive and synchronizes ready results", () => {
    const revealed = revealedRoomWithPendingAi();
    expect(revealed.archive[0]).toMatchObject({
      fakeId: "p0",
      ai: {
        jobId: JOB_ID,
        criticStatus: "pending",
        renditionStatus: "pending",
      },
    });

    const criticReady = apply(revealed, {
      type: "RESOLVE_ROUND_CRITIC",
      roundNo: 1,
      jobId: JOB_ID,
      verdict: sampleVerdict({
        subjectGuess: "penguin",
        detective: { playerId: "p0", reason: "Red knew exactly where not to draw." },
      }),
    });
    expect(criticReady.archive[0]).toMatchObject({
      criticSubjectMatched: true,
      criticDetectiveMatched: true,
      ai: { criticStatus: "ready", critic: { subjectGuess: "penguin" } },
    });
  });

  it("applies a late rendition to its archived round after the next round starts", () => {
    let state = revealedRoomWithPendingAi();
    state = apply(state, {
      type: "START_ROUND",
      word: "octopus",
      category: "Animals",
      qmId: null,
      fakeId: "p1",
      turnOrder: ["p0", "p1", "p2", "p3", "p4"],
    });
    expect(state.round?.roundNo).toBe(2);

    state = apply(state, {
      type: "RESOLVE_ROUND_RENDITION",
      roundNo: 1,
      jobId: JOB_ID,
      renditionId: JOB_ID,
    });
    expect(state.round?.roundNo).toBe(2);
    expect(state.archive[0].ai).toMatchObject({
      renditionStatus: "ready",
      renditionId: JOB_ID,
    });
  });

  it("redacts ready AI content until the human outcome is public", () => {
    let state = apply(
      votingRoom({ aiDetective: true }),
      { type: "START_ROUND_AI", roundNo: 1, jobId: JOB_ID },
    );
    state = apply(state, {
      type: "RESOLVE_ROUND_CRITIC",
      roundNo: 1,
      jobId: JOB_ID,
      verdict: sampleVerdict(),
    });
    state = apply(state, {
      type: "RESOLVE_ROUND_RENDITION",
      roundNo: 1,
      jobId: JOB_ID,
      renditionId: JOB_ID,
    });
    for (const [voterId, targetId] of [
      ["p0", "p1"],
      ["p1", "p0"],
      ["p2", "p0"],
      ["p3", "p0"],
      ["p4", "p0"],
    ] as Array<[string, string]>) {
      state = apply(state, { type: "CAST_VOTE", voterId, targetId, now: 0 });
    }
    expect(state.phase).toBe("guessing");

    const hidden = redactState(state, "p1").state.round!.ai;
    expect(hidden).toEqual({
      jobId: null,
      criticStatus: "ready",
      critic: null,
      renditionStatus: "ready",
      renditionId: null,
    });

    state = apply(state, {
      type: "SUBMIT_GUESS",
      playerId: "p0",
      text: "walrus",
      matched: false,
    });
    const visible = redactState(state, "p1").state.round!.ai;
    expect(visible.critic?.title).toBe("Untitled Emergency");
    expect(visible.renditionId).toBe(JOB_ID);
  });
});
