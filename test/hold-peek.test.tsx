import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HoldPeek } from "../src/components/HoldPeek";

interface HoldPeekButtonProps {
  ref?: (node: HTMLButtonElement | null) => void;
  onPointerDown: (event: {
    currentTarget: Pick<HTMLButtonElement, "setPointerCapture">;
    pointerId: number;
    preventDefault: () => void;
  }) => void;
  onKeyDown: (event: {
    key: string;
    repeat: boolean;
    preventDefault: () => void;
  }) => void;
}

class VisibilityTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

describe("HoldPeek release recovery", () => {
  let originalWindow: PropertyDescriptor | undefined;
  let originalDocument: PropertyDescriptor | undefined;
  let windowTarget: EventTarget;
  let documentTarget: VisibilityTarget;

  beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    windowTarget = new EventTarget();
    documentTarget = new VisibilityTarget();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowTarget,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: documentTarget,
    });
  });

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  function holdPeekHarness() {
    let revealed = false;
    const onRevealChange = (next: boolean) => {
      revealed = next;
    };
    const button = () =>
      HoldPeek({
        label: "Hold to peek at the wall",
        revealed,
        onRevealChange,
        children: "Hold to peek at the wall",
      }) as ReactElement<HoldPeekButtonProps>;
    const markup = () =>
      renderToStaticMarkup(
        <>
          {button()}
          {revealed && <div data-overlay="wall">Private wall overlay</div>}
        </>,
      );
    return { button, markup };
  }

  it("hides the overlay when window blur replaces a lost keyup", () => {
    const harness = holdPeekHarness();
    harness.button().props.onKeyDown({
      key: " ",
      repeat: false,
      preventDefault: () => undefined,
    });
    expect(harness.markup()).toContain('aria-pressed="true"');
    expect(harness.markup()).toContain("Private wall overlay");

    windowTarget.dispatchEvent(new Event("blur"));

    expect(harness.markup()).toContain('aria-pressed="false"');
    expect(harness.markup()).not.toContain("Private wall overlay");
  });

  it("captures the pointer and hides the overlay when the pointer is lost", () => {
    const harness = holdPeekHarness();
    let capturedPointer: number | null = null;
    harness.button().props.onPointerDown({
      currentTarget: {
        setPointerCapture: (pointerId) => {
          capturedPointer = pointerId;
        },
      },
      pointerId: 7,
      preventDefault: () => undefined,
    });
    expect(capturedPointer).toBe(7);
    expect(harness.markup()).toContain('aria-pressed="true"');

    windowTarget.dispatchEvent(new Event("pointercancel"));

    expect(harness.markup()).toContain('aria-pressed="false"');
    expect(harness.markup()).not.toContain("Private wall overlay");
  });

  it("hides the overlay when the document becomes hidden", () => {
    const harness = holdPeekHarness();
    harness.button().props.onKeyDown({
      key: "Enter",
      repeat: false,
      preventDefault: () => undefined,
    });
    documentTarget.visibilityState = "hidden";

    documentTarget.dispatchEvent(new Event("visibilitychange"));

    expect(harness.markup()).toContain('aria-pressed="false"');
    expect(harness.markup()).not.toContain("Private wall overlay");
  });

  it("hides the overlay when the hold control unmounts during hand-off", () => {
    const harness = holdPeekHarness();
    harness.button().props.onKeyDown({
      key: "Enter",
      repeat: false,
      preventDefault: () => undefined,
    });

    harness.button().props.ref?.(null);

    expect(harness.markup()).toContain('aria-pressed="false"');
    expect(harness.markup()).not.toContain("Private wall overlay");
  });
});
