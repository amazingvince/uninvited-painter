import { describe, expect, it } from "vitest";
import { drawingCanvasLabel } from "../src/lib/labels";

describe("drawing canvas labels", () => {
  it("describes the active artist and progress", () => {
    expect(
      drawingCanvasLabel({
        actor: "Maya",
        strokeNo: 4,
        strokeTotal: 10,
        live: true,
      }),
    ).toBe("Live drawing canvas. Maya is drawing, stroke 4 of 10.");
  });

  it("describes a player's own canvas without leaking a word", () => {
    expect(
      drawingCanvasLabel({
        actor: "Your",
        strokeNo: 2,
        strokeTotal: 10,
        live: false,
      }),
    ).toBe("Drawing canvas. Your stroke, 2 of 10.");
  });
});
