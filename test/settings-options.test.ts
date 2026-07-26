import { describe, expect, it } from "vitest";
import { createRoom } from "../shared/engine";
import {
  SETTING_OPTIONS,
  advancedSettingsSummary,
} from "../src/lib/settingsOptions";

describe("settings presentation", () => {
  const defaults = createRoom({
    code: "",
    mode: "local",
    hostId: "",
  }).settings;

  it("offers every legal setting value once", () => {
    expect(SETTING_OPTIONS.passes.map((option) => option.value)).toEqual([1, 2, 3]);
    expect(SETTING_OPTIONS.pen.map((option) => option.value)).toEqual(["line", "free"]);
    expect(SETTING_OPTIONS.clock.map((option) => option.value)).toEqual([0, 60, 90]);
    expect(SETTING_OPTIONS.tone.map((option) => option.value)).toEqual([
      "witty",
      "savage",
      "absurd",
    ]);
  });

  it("summarizes only non-default advanced choices", () => {
    expect(advancedSettingsSummary(defaults, "local")).toBe("Standard rules");
    expect(
      advancedSettingsSummary(
        { ...defaults, penMode: "free", inkLimit: 60, aiDetective: true },
        "local",
      ),
    ).toBe("Free ink · short ink · detective on");
  });

  it("includes online-only clock and presence choices online", () => {
    expect(
      advancedSettingsSummary(
        { ...defaults, strokeClock: 60, presence: "relaxed" },
        "online",
      ),
    ).toContain("60s clock");
  });
});
