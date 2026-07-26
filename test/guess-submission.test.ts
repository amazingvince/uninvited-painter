import { describe, expect, it } from "vitest";
import { prepareGuessSubmission } from "../shared/fuzzy";

describe("canonical guess submission", () => {
  it("matches and reveals the exact same 60-character punctuation-heavy text", () => {
    const raw = `${".".repeat(60)}penguin`;
    const prepared = prepareGuessSubmission(raw, "penguin");

    expect(prepared.text).toBe(".".repeat(60));
    expect(prepared.matched).toBe(false);
  });

  it("trims invisible boundary whitespace before applying the stored limit", () => {
    const raw = `\u2003${"x".repeat(59)} penguin`;
    const prepared = prepareGuessSubmission(raw, "penguin");

    expect(prepared.text).toBe(`${"x".repeat(59)} `);
    expect(prepared.text).toHaveLength(60);
    expect(prepared.matched).toBe(false);
  });

  it("still accepts punctuation around a word when the word is inside the limit", () => {
    const prepared = prepareGuessSubmission("... Penguin?!", "penguin");
    expect(prepared).toEqual({ text: "... Penguin?!", matched: true });
  });
});
