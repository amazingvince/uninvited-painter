// @vitest-environment jsdom

// The test runner is Node, while the application tsconfig intentionally omits
// Node ambient types.
// @ts-expect-error -- built-in available to Vitest at runtime
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HoldToReveal } from "../src/components/HoldToReveal";

const themeCss = readFileSync(
  `${
    (
      globalThis as typeof globalThis & {
        process: { cwd: () => string };
      }
    ).process.cwd()
  }/src/theme.css`,
  "utf8",
);

describe("full-screen hold control", () => {
  let container: HTMLDivElement;
  let root: Root;
  let stylesheet: HTMLStyleElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    stylesheet = document.createElement("style");
    stylesheet.textContent = themeCss;
    document.head.append(stylesheet);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    stylesheet?.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("owns a flex box and reveals private content only while Space is held", () => {
    act(() => {
      root.render(
        <div className="frame">
          <HoldToReveal
            gate={<div className="screen">Private card gate</div>}
            card={() => <div className="screen">Secret penguin</div>}
          />
        </div>,
      );
    });

    const control = container.querySelector<HTMLElement>(".hold-gate");
    if (!control) throw new Error("Expected mounted hold control");

    const computed = getComputedStyle(control);
    expect(computed.display).toBe("flex");
    expect(computed.flexGrow).toBe("1");
    expect(computed.width).toBe("100%");

    act(() => {
      control.focus();
      control.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(control);
    expect(control.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Secret penguin");

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keyup", { key: " ", bubbles: true }),
      );
    });
    expect(control.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).not.toContain("Secret penguin");
  });
});
