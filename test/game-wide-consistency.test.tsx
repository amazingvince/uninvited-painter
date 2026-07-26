// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ArchiveEntry, Player } from "../shared/types";
import { Final } from "../src/screens/Final";
import { HouseWords } from "../src/screens/HouseWords";
import { Roster } from "../src/screens/Roster";
import { Standings } from "../src/screens/Standings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PLAYERS: Player[] = [
  {
    id: "maya",
    name: "Maya",
    colorIndex: 0,
    score: 5,
    connected: true,
  },
  {
    id: "devon",
    name: "Devon",
    colorIndex: 1,
    score: 5,
    connected: true,
  },
  {
    id: "priya",
    name: "Priya",
    colorIndex: 2,
    score: 3,
    connected: true,
  },
];

const ENTRY: ArchiveEntry = {
  roundNo: 2,
  word: "penguin",
  strokes: [],
  outcome: "survived",
  fakeName: "Maya",
  fakeId: "maya",
};

function elementFrom(markup: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = markup;
  return container;
}

function scoreRows(container: ParentNode) {
  return [...container.querySelectorAll(".score-row")].map(
    (row) => ({
      rank: row.querySelector(".score-rank")?.textContent,
      player: row.querySelector(".score-player")?.childNodes[0]?.textContent,
      status: row.querySelector(".score-status")?.textContent ?? null,
      score: row.querySelector(".score-value")?.textContent,
    }),
  );
}

describe("small game setup actions", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("uses native reorder boundaries and associates roster errors with the input", () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Roster
          players={PLAYERS}
          onAdd={() => "That name is already here"}
          onRemove={() => undefined}
          onReorder={() => undefined}
          onBack={() => undefined}
          onNext={() => undefined}
        />,
      );
    });

    const moveMayaUp = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Maya up"]',
    );
    const moveMayaDown = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Maya down"]',
    );
    const movePriyaDown = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Priya down"]',
    );
    expect(moveMayaUp?.disabled).toBe(true);
    expect(moveMayaDown?.disabled).toBe(false);
    expect(movePriyaDown?.disabled).toBe(true);
    expect(
      [...container.querySelectorAll('button[aria-label^="Move "]')].every(
        (button) => button.classList.contains("tap-target"),
      ),
    ).toBe(true);
    expect(
      [...container.querySelectorAll('button[aria-label^="Remove "]')].every(
        (button) => button.classList.contains("tap-target"),
      ),
    ).toBe(true);

    const addButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add player"]',
    );
    expect(addButton?.classList.contains("tap-target")).toBe(true);
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Add a player"]',
    )!;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      valueSetter.call(input, "Maya");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      addButton?.click();
    });

    const descriptionId = input.getAttribute("aria-describedby");
    expect(descriptionId).not.toBeNull();
    expect(container.querySelector(`#${descriptionId}`)?.textContent).toBe(
      "That name is already here",
    );

    act(() => root.unmount());
  });

  it("names 44px house-word actions and exposes pot changes as a polite status", () => {
    const container = elementFrom(
      renderToStaticMarkup(
        <HouseWords
          ownWords={["penguin"]}
          totalCount={3}
          note="Two from you"
          onAdd={() => undefined}
          onRemove={() => undefined}
          onBack={() => undefined}
        />,
      ),
    );

    const add = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add words"]',
    );
    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove penguin"]',
    );
    expect(add?.classList.contains("tap-target")).toBe(true);
    expect(remove?.classList.contains("tap-target")).toBe(true);
    expect(
      container.querySelector('[role="status"][aria-live="polite"]')
        ?.getAttribute("aria-label"),
    ).toBe("3 words in the pot");
  });
});

describe("competition rankings", () => {
  it("keeps tied standings stable and labels every leader without relying on red", () => {
    const container = elementFrom(
      renderToStaticMarkup(
        <Standings
          players={PLAYERS}
          roundsPlayed={2}
          totalRounds={5}
          waiting="Waiting"
        />,
      ),
    );

    expect(scoreRows(container)).toEqual([
      { rank: "1", player: "Maya", status: "Leader", score: "5" },
      { rank: "1", player: "Devon", status: "Leader", score: "5" },
      { rank: "3", player: "Priya", status: null, score: "3" },
    ]);
  });

  it("uses the same competition ranks and visible winner labels in the final", () => {
    const container = elementFrom(
      renderToStaticMarkup(
        <Final
          players={PLAYERS}
          archive={[ENTRY]}
          waiting="Waiting"
        />,
      ),
    );

    expect(scoreRows(container)).toEqual([
      { rank: "1", player: "Maya", status: "Winner", score: "5" },
      { rank: "1", player: "Devon", status: "Winner", score: "5" },
      { rank: "3", player: "Priya", status: null, score: "3" },
    ]);
  });
});

describe("finished-game drawing actions", () => {
  it("includes the word and round in every archive drawing action name", () => {
    const secondEntry: ArchiveEntry = {
      ...ENTRY,
      roundNo: 3,
      word: "umbrella",
    };
    const container = elementFrom(
      renderToStaticMarkup(
        <Final
          players={PLAYERS}
          archive={[ENTRY, secondEntry]}
          waiting="Waiting"
        />,
      ),
    );

    expect(
      [...container.querySelectorAll("button.archive-cell")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Save round 2 drawing of penguin",
      "Save round 3 drawing of umbrella",
    ]);
  });
});
