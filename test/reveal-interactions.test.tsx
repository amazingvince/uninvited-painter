// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, RoundAi, RoundState } from "../shared/types";
import { Guess } from "../src/screens/Guess";
import { Vote } from "../src/screens/Vote";
import { Tally } from "../src/screens/Tally";
import { CriticVerdict } from "../src/screens/CriticVerdict";
import { RenditionReveal } from "../src/screens/RenditionReveal";
import { Reveal } from "../src/screens/Reveal";

const share = vi.hoisted(() => ({
  drawingPng: vi.fn(),
  shareOrDownload: vi.fn(),
}));

vi.mock("../src/lib/share", () => share);

const PLAYERS: Player[] = [
  { id: "p0", name: "Devon", colorIndex: 0, score: 0, connected: true },
  { id: "p1", name: "Maya", colorIndex: 1, score: 0, connected: true },
  { id: "p2", name: "Priya", colorIndex: 2, score: 0, connected: true },
];

const READY_AI: RoundAi = {
  jobId: "00000000-0000-4000-8000-000000000001",
  criticStatus: "ready",
  critic: {
    title: "Untitled Emergency",
    subjectGuess: "penguin",
    detective: { playerId: "p1", reason: "Maya drew around the truth." },
  },
  renditionStatus: "ready",
  renditionId: "00000000-0000-4000-8000-000000000001",
};

function revealedRound(): RoundState {
  return {
    roundNo: 1,
    word: "penguin",
    category: "Animals",
    qmId: null,
    fakeId: "p1",
    turnOrder: ["p0", "p1", "p2"],
    schedule: ["p0", "p1", "p2"],
    turnIndex: 3,
    dealt: true,
    seen: ["p0", "p1", "p2"],
    strokes: [],
    votes: { p0: "p1", p1: "p0", p2: "p1" },
    droppedIds: [],
    accusedId: "p1",
    guess: "penguin",
    outcome: "caught_named",
    scoreDelta: { p1: 2 },
    guessDeadline: null,
    turnDeadline: null,
    ai: READY_AI,
  };
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`Expected button containing “${text}”`);
  return button;
}

describe("deliberate ballot and reveal interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    share.drawingPng.mockReset();
    share.shareOrDownload.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("opens guess confirmation from click and cancel keeps the text and countdown running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <Guess
          category="Animals"
          strokes={[]}
          deadline={Date.now() + 5_000}
          onSubmit={onSubmit}
        />,
      );
    });
    const input = container.querySelector("input")!;
    setInput(input, "penguin");

    act(() => buttonWithText(container, "Say it out loud").click());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Submit “PENGUIN”?",
    );
    expect(container.textContent).toContain("0:05 · guessing right steals");

    act(() => buttonWithText(container, "Keep thinking").click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(input.value).toBe("penguin");

    act(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toContain("0:04 · guessing right steals");
  });

  it("opens guess confirmation from Enter and submits only once", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <Guess
          category="Animals"
          strokes={[]}
          deadline={null}
          onSubmit={onSubmit}
        />,
      );
    });
    const input = container.querySelector("input")!;
    setInput(input, "  penguin  ");

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onSubmit).not.toHaveBeenCalled();
    const confirm = buttonWithText(container, "Submit one guess");
    act(() => confirm.click());
    act(() => confirm.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("penguin");
  });

  it("announces a selected ballot without locking until the named action", () => {
    const onLock = vi.fn();
    act(() => {
      root.render(
        <Vote
          voterId="p2"
          voterName="Priya"
          candidates={["p1", "p2"]}
          qmId="p0"
          players={PLAYERS}
          strokes={[]}
          votersIn={[]}
          onLock={onLock}
        />,
      );
    });

    const maya = buttonWithText(container, "Maya");
    expect(maya.getAttribute("aria-pressed")).toBe("false");
    act(() => maya.click());

    expect(onLock).not.toHaveBeenCalled();
    expect(maya.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Selected Maya. Review the highlighted lines, then lock the ballot.",
    );

    act(() => buttonWithText(container, "Lock in Maya").click());
    expect(onLock).toHaveBeenCalledWith("p1");
  });

  it("names the finished drawing as a stateful zoom control", () => {
    act(() => {
      root.render(
        <Vote
          voterId="p2"
          candidates={["p1", "p2"]}
          qmId="p0"
          players={PLAYERS}
          strokes={[]}
          votersIn={[]}
          onLock={() => undefined}
        />,
      );
    });

    const drawing = container.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]',
    );
    expect(drawing?.getAttribute("aria-label")).toBe(
      "Finished drawing. Enlarge drawing.",
    );

    act(() => drawing?.click());
    expect(drawing?.getAttribute("aria-expanded")).toBe("true");
    expect(drawing?.getAttribute("aria-label")).toBe(
      "Finished drawing. Shrink drawing.",
    );
  });

  it("renders reduced-motion tally values immediately with progress semantics", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    act(() => {
      root.render(
        <Tally
          votes={{ p0: "p1", p1: "p0", p2: "p1" }}
          players={PLAYERS}
          accusedId="p1"
          fakeWasAccused
          buttonLabel="Continue"
          onContinue={() => undefined}
        />,
      );
    });

    const mayaBar = container.querySelector<HTMLElement>(
      '[role="progressbar"][aria-label="Maya · 2 votes"]',
    );
    expect(mayaBar?.getAttribute("aria-valuenow")).toBe("2");
    expect(mayaBar?.getAttribute("aria-valuemax")).toBe("2");
    expect(mayaBar?.querySelector<HTMLElement>("div")?.style.width).toBe(
      "100%",
    );
  });

  it("marks pending AI work busy while keeping both skip actions reachable", () => {
    const pending: RoundAi = {
      jobId: READY_AI.jobId,
      criticStatus: "pending",
      critic: null,
      renditionStatus: "pending",
      renditionId: null,
    };
    act(() => {
      root.render(
        <CriticVerdict ai={pending} players={PLAYERS} onNext={() => undefined} />,
      );
    });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(buttonWithText(container, "Skip her — the attribution")).not.toBeNull();

    act(() => {
      root.render(
        <RenditionReveal
          ai={pending}
          strokes={[]}
          onNext={() => undefined}
        />,
      );
    });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(buttonWithText(container, "Skip ahead — standings")).not.toBeNull();
  });

  it("retries a failed rendition decode without restarting the AI job", async () => {
    let decodeAttempts = 0;
    class FailingImage {
      src = "";
      decode() {
        decodeAttempts += 1;
        return Promise.reject(new Error("decode failed"));
      }
    }
    vi.stubGlobal("Image", FailingImage);
    await act(async () => {
      root.render(
        <RenditionReveal
          ai={READY_AI}
          strokes={[]}
          onNext={() => undefined}
        />,
      );
      await Promise.resolve();
    });

    expect(decodeAttempts).toBe(1);
    await act(async () => {
      buttonWithText(container, "Try image again").click();
      await Promise.resolve();
    });
    expect(decodeAttempts).toBe(2);
    expect(buttonWithText(container, "Standings")).not.toBeNull();
  });

  it("keeps official results ahead of non-scoring AI and reports save failures", async () => {
    share.drawingPng.mockRejectedValueOnce(new Error("export failed"));
    act(() => {
      root.render(
        <Reveal
          round={revealedRound()}
          players={PLAYERS}
          nextLabel="Standings"
          onNext={() => undefined}
        />,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Official score");
    expect(text).toContain("Luna's non-scoring opinion");
    expect(text.indexOf("The word was")).toBeLessThan(
      text.indexOf("Luna's non-scoring opinion"),
    );
    expect(text.indexOf("Standings")).toBeLessThan(
      text.indexOf("Save this drawing as a PNG"),
    );

    await act(async () => {
      buttonWithText(container, "Save this drawing as a PNG").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn’t save the drawing",
    );
  });
});
