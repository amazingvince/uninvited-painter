// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createRoom, reduce } from "../shared/engine";
import { redactState, type PublicRoomState } from "../shared/protocol";
import type { GameEvent, RoomState } from "../shared/types";
import { DisconnectOverlay, ReconnectingBanner } from "../src/screens/Disconnect";
import { HostLobby } from "../src/screens/HostLobby";
import { JoinerSetup } from "../src/screens/JoinerSetup";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function apply(state: RoomState, event: GameEvent): RoomState {
  const result = reduce(state, event);
  if (!result.ok) throw new Error(`${event.type}: ${result.error}`);
  return result.state;
}

function lobby(): RoomState {
  let state = createRoom({ code: "MOLT", mode: "online", hostId: "" });
  for (const [index, name] of ["Devon", "Maya", "Priya", "Tomas", "Ines"].entries()) {
    state = apply(state, {
      type: "ADD_PLAYER",
      player: { id: `p${index}`, name, colorIndex: index },
    });
  }
  return state;
}

function publicLobby(): PublicRoomState {
  return redactState(lobby(), "p0").state;
}

function heldRound(additionalHolds = 1): PublicRoomState {
  let state = lobby();
  state = apply(state, {
    type: "START_ROUND",
    word: "penguin",
    category: "Animals",
    qmId: null,
    fakeId: "p1",
    turnOrder: ["p0", "p1", "p2", "p3", "p4"],
  });
  const now = Date.now();
  state = apply(state, {
    type: "SET_CONNECTED",
    playerId: "p1",
    connected: false,
    now,
  });
  state = apply(state, {
    type: "SET_CONNECTED",
    playerId: "p2",
    connected: false,
    now: now + 1_000,
  });
  if (additionalHolds > 1) {
    state = apply(state, {
      type: "SET_CONNECTED",
      playerId: "p3",
      connected: false,
      now: now + 2_000,
    });
  }
  const publicState = redactState(state, "p0").state;
  return {
    ...publicState,
    round: publicState.round ? { ...publicState.round, fakeId: "p1" } : null,
  };
}

function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, "").replaceAll("&amp;", "&");
}

describe("online recovery presentation", () => {
  it("announces early and prolonged reconnect attempts with the right recovery promise", () => {
    const early = renderToStaticMarkup(<ReconnectingBanner attempt={1} />);
    const prolonged = renderToStaticMarkup(<ReconnectingBanner attempt={4} />);

    expect(early).toContain('role="status"');
    expect(early).toContain('aria-live="polite"');
    expect(textOf(early)).toContain("Connection lost · reconnecting…");
    expect(textOf(prolonged)).toContain(
      "Still reconnecting · your seat and locked actions are being held",
    );
  });

  it.each([
    ["checking", "Checking room…"],
    ["connecting", "Connecting…"],
    ["connected", "Connected"],
    ["reconnecting", "Reconnecting — your name is still here"],
    ["gone", "Room closed"],
  ] as const)(
    "shows %s truthfully",
    (connectionState, label) => {
      const markup = renderToStaticMarkup(
        <JoinerSetup
          code="MOLT"
          state={publicLobby()}
          connectionState={connectionState}
          error={null}
          onJoin={() => undefined}
          onLeave={() => undefined}
        />,
      );

      expect(textOf(markup)).toContain(label);
    },
  );

  it("keeps ready disabled through a reconnect and enables it after the socket opens", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const props = {
      code: "MOLT",
      state: publicLobby(),
      error: null,
      onJoin: () => undefined,
      onLeave: () => undefined,
    };

    act(() => {
      root.render(<JoinerSetup {...props} connectionState="reconnecting" />);
    });
    const input = container.querySelector("input")!;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      valueSetter.call(input, "Maya");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector("button.btn")?.hasAttribute("disabled")).toBe(true);

    act(() => {
      root.render(<JoinerSetup {...props} connectionState="connected" />);
    });
    expect(container.querySelector("button.btn")?.hasAttribute("disabled")).toBe(false);
    act(() => root.unmount());
  });

  it.each([
    [1, "and 1 more seat held"],
    [2, "and 2 more seats held"],
  ] as const)(
    "puts the fake-drop consequence before the action with %i additional hold(s)",
    (additionalHolds, heldCopy) => {
    const markup = renderToStaticMarkup(
      <DisconnectOverlay
        state={heldRound(additionalHolds)}
        isHost
        onDrop={() => undefined}
      />,
    );
    const text = textOf(markup);
    const consequence = "Dropping the fake voids this round and deals fresh cards.";
    const action = "Drop Maya and continue";

    expect(text).toContain(heldCopy);
    expect(text.indexOf(consequence)).toBeLessThan(text.indexOf(action));
    expect(markup).toContain('aria-describedby="drop-player-consequence"');
    expect(markup).toContain('id="drop-player-consequence"');
    },
  );

  it("labels live, held, and away lobby seats with both a symbol and text", () => {
    const state = publicLobby();
    const players = state.players.map((player, index) => ({
      ...player,
      connected: index === 0,
    }));
    const markup = renderToStaticMarkup(
      <HostLobby
        state={{ ...state, players, holds: { p1: Date.now() + 30_000 } }}
        youId="p0"
        isHost
        shareUrl="https://example.test/r/MOLT"
        onSettings={() => undefined}
        onStart={() => undefined}
        onRules={() => undefined}
        onHouseWords={() => undefined}
      />,
    );
    const text = textOf(markup);

    expect(text).toContain("● live");
    expect(text).toContain("◐ seat held");
    expect(text).toContain("○ away");
  });
});
