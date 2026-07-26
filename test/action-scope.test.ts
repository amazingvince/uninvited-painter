import { describe, expect, it } from "vitest";
import { createRoom, normalizeRoom, reduce } from "../shared/engine";
import {
  actionScopeFor,
  scopeMatchesState,
  type ActionScope,
} from "../shared/protocol";

describe("authoritative action scope", () => {
  it("advances the persisted game generation for the same crowd", () => {
    const room = {
      ...createRoom({ code: "MOLT", mode: "online", hostId: "p0" }),
      phase: "closed" as const,
    };
    const result = reduce(room, { type: "PLAY_AGAIN" });
    if (!result.ok) throw new Error(result.error);

    expect(room.gameNo).toBe(1);
    expect(result.state.gameNo).toBe(2);

    const legacy = { ...room } as Partial<typeof room>;
    delete legacy.gameNo;
    delete legacy.roundVersion;
    expect(normalizeRoom(legacy as typeof room).gameNo).toBe(1);
    expect(normalizeRoom(legacy as typeof room).roundVersion).toBe(0);
  });

  it("expires a queued action when the turn advances or a new game reuses the same phase", () => {
    const room = createRoom({ code: "MOLT", mode: "online", hostId: "p0" });
    const drawing = {
      ...room,
      gameNo: 4,
      roundVersion: 5,
      phase: "drawing" as const,
      round: {
        roundNo: 2,
        turnIndex: 3,
      },
    };
    const scope = actionScopeFor(drawing);

    expect(scope).toEqual({
      gameNo: 4,
      roundVersion: 5,
      phase: "drawing",
      roundNo: 2,
      turnIndex: 3,
    });
    expect(
      scopeMatchesState(scope, {
        ...drawing,
        round: { ...drawing.round, turnIndex: 4 },
      }),
    ).toBe(false);
    expect(scopeMatchesState(scope, { ...drawing, gameNo: 5 })).toBe(false);
    expect(
      scopeMatchesState(scope, { ...drawing, roundVersion: 6 }),
    ).toBe(false);
  });

  it("fails closed for malformed supplied scopes", () => {
    const room = {
      ...createRoom({ code: "MOLT", mode: "online", hostId: "p0" }),
      gameNo: 1,
      roundVersion: 0,
    };
    expect(scopeMatchesState({ gameNo: 1 } as ActionScope, room)).toBe(false);
    expect(scopeMatchesState(null, room)).toBe(false);
  });
});
