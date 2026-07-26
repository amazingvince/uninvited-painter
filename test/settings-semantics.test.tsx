// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoom } from "../shared/engine";
import type { Settings } from "../shared/types";
import { DeckSettings } from "../src/screens/DeckSettings";

function SettingsHarness() {
  const [settings, setSettings] = useState<Settings>(
    () => createRoom({ code: "", mode: "local", hostId: "" }).settings,
  );
  return (
    <DeckSettings
      settings={settings}
      houseWordCount={0}
      onHouseWords={() => undefined}
      onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
      onBack={() => undefined}
      onStart={() => undefined}
    />
  );
}

function buttonWithShout(container: ParentNode, name: string): HTMLButtonElement {
  const heading = [...container.querySelectorAll(".shout")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  const button = heading?.closest("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected choice button headed ${name}`);
  }
  return button;
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`Expected choice button named ${name}`);
  return button;
}

describe("local settings selection semantics", () => {
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
    act(() => root.render(<SettingsHarness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("announces and updates the selected deck, length, passes, and temperament", () => {
    const animals = buttonWithShout(container, "Animals");
    const food = buttonWithShout(container, "Food");
    const fiveRounds = buttonNamed(container, "5");
    const threeRounds = buttonNamed(container, "3");
    const twoPasses = buttonNamed(container, "2 passes");
    const onePass = buttonNamed(container, "1 pass");
    const witty = buttonNamed(container, "Witty");
    const savage = buttonNamed(container, "Savage");

    expect(animals.getAttribute("aria-pressed")).toBe("true");
    expect(food.getAttribute("aria-pressed")).toBe("false");
    expect(fiveRounds.getAttribute("aria-pressed")).toBe("true");
    expect(threeRounds.getAttribute("aria-pressed")).toBe("false");
    expect(twoPasses.getAttribute("aria-pressed")).toBe("true");
    expect(onePass.getAttribute("aria-pressed")).toBe("false");
    expect(witty.getAttribute("aria-pressed")).toBe("true");
    expect(savage.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      food.click();
      threeRounds.click();
      onePass.click();
      savage.click();
    });

    expect(buttonWithShout(container, "Animals").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(buttonWithShout(container, "Food").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(buttonNamed(container, "5").getAttribute("aria-pressed")).toBe("false");
    expect(buttonNamed(container, "3").getAttribute("aria-pressed")).toBe("true");
    expect(buttonNamed(container, "2 passes").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(buttonNamed(container, "1 pass").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(buttonNamed(container, "Witty").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(buttonNamed(container, "Savage").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
