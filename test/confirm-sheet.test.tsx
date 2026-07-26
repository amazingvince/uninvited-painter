// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmSheet } from "../src/components/ConfirmSheet";

describe("ConfirmSheet focus containment", () => {
  let container: HTMLDivElement;
  let opener: HTMLButtonElement;
  let root: ReturnType<typeof createRoot>;
  let rootUnmounted: boolean;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(opener);
    opener.focus();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    rootUnmounted = false;
  });

  afterEach(() => {
    if (!rootUnmounted) act(() => root.unmount());
    container.remove();
    opener.remove();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("cycles Tab in both directions and restores the opener on close", () => {
    act(() => {
      root.render(
        <ConfirmSheet
          title="Publish?"
          body="This will be public."
          confirmLabel="Publish publicly"
          cancelLabel="Cancel"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
    });

    const [confirm, cancel] = [...container.querySelectorAll("button")];
    expect(document.activeElement).toBe(cancel);

    act(() => {
      cancel.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(confirm);

    act(() => {
      confirm.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(cancel);

    act(() => root.unmount());
    rootUnmounted = true;
    expect(document.activeElement).toBe(opener);
  });

  it("contains focus when controls are disabled or removed and keeps Escape working", () => {
    const onCancel = vi.fn();
    act(() => {
      root.render(
        <ConfirmSheet
          title="Leave?"
          body="Your seat will be released."
          confirmLabel="Leave"
          cancelLabel="Stay"
          onConfirm={() => undefined}
          onCancel={onCancel}
        />,
      );
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const [confirm, cancel] = [...container.querySelectorAll("button")];
    confirm.disabled = true;
    cancel.remove();
    opener.focus();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(dialog);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
