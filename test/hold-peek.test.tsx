// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HoldPeek } from "../src/components/HoldPeek";

interface PeekHarnessProps {
  showControl?: boolean;
  showInactiveSibling?: boolean;
}

function PeekHarness({
  showControl = true,
  showInactiveSibling = false,
}: PeekHarnessProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <>
      {showInactiveSibling && (
        <HoldPeek
          label="Inactive peek control"
          revealed={revealed}
          onRevealChange={setRevealed}
        >
          Inactive
        </HoldPeek>
      )}
      {showControl && (
        <HoldPeek
          label="Hold to peek at the wall"
          revealed={revealed}
          onRevealChange={setRevealed}
        >
          Hold to peek
        </HoldPeek>
      )}
      {revealed && <div data-overlay="wall">Private wall overlay</div>}
    </>
  );
}

function dispatchPointer(target: EventTarget, type: string, pointerId = 7) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  target.dispatchEvent(event);
}

describe("HoldPeek release recovery", () => {
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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.deleteProperty(document, "visibilityState");
  });

  function renderHarness(props: PeekHarnessProps = {}) {
    act(() => root.render(<PeekHarness {...props} />));
  }

  function activeButton() {
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Hold to peek at the wall"]',
    );
    if (!button) throw new Error("Expected mounted hold-to-peek button");
    return button;
  }

  function overlay() {
    return container.querySelector('[data-overlay="wall"]');
  }

  function expectRevealed() {
    expect(activeButton().getAttribute("aria-pressed")).toBe("true");
    expect(overlay()?.textContent).toBe("Private wall overlay");
  }

  function expectHidden() {
    expect(activeButton().getAttribute("aria-pressed")).toBe("false");
    expect(overlay()).toBeNull();
  }

  it("recovers from a lost keyboard keyup when the window blurs", () => {
    renderHarness();

    act(() => {
      activeButton().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expectRevealed();

    act(() => window.dispatchEvent(new Event("blur")));

    expectHidden();
  });

  it("recovers when the active pointer release is lost", () => {
    renderHarness();

    act(() => dispatchPointer(activeButton(), "pointerdown"));
    expectRevealed();

    act(() => dispatchPointer(window, "pointercancel"));

    expectHidden();
  });

  it("recovers when the document becomes hidden", () => {
    renderHarness();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    act(() => {
      activeButton().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expectRevealed();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expectHidden();
  });

  it("releases and removes private content when React unmounts the control", () => {
    renderHarness();
    act(() => dispatchPointer(activeButton(), "pointerdown"));
    expectRevealed();

    act(() => root.render(<PeekHarness showControl={false} />));

    expect(
      container.querySelector('[aria-label="Hold to peek at the wall"]'),
    ).toBeNull();
    expect(overlay()).toBeNull();
  });

  it("keeps an active instance held when an inactive sibling with the same callback unmounts", () => {
    renderHarness({ showInactiveSibling: true });
    act(() => dispatchPointer(activeButton(), "pointerdown"));
    expectRevealed();

    act(() =>
      root.render(<PeekHarness showInactiveSibling={false} showControl />),
    );

    expectRevealed();

    act(() => window.dispatchEvent(new Event("blur")));
    expectHidden();
  });
});
