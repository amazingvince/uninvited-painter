import { describe, expect, it } from "vitest";
import type { ArchiveEntry } from "../shared/types";
import { criticAccuracy, criticChoice } from "../src/lib/aiStats";

function entry(
  roundNo: number,
  rating: number | undefined,
  matches: {
    subject?: boolean;
    detective?: boolean;
    outcome?: ArchiveEntry["outcome"];
  } = {},
): ArchiveEntry {
  return {
    roundNo,
    word: `word ${roundNo}`,
    strokes: [],
    outcome: matches.outcome ?? "survived",
    fakeName: "Fake",
    criticSubjectMatched: matches.subject,
    criticDetectiveMatched: matches.detective,
    ai: {
      jobId: "00000000-0000-4000-8000-000000000001",
      criticStatus: rating === undefined ? "unavailable" : "ready",
      critic:
        rating === undefined
          ? null
          : {
              title: `Work ${roundNo}`,
              subjectGuess: "something",
              confidence: 50,
              rating,
              ratingTag: "Questionably framed",
              review: "It happened.",
            },
      renditionStatus: "unavailable",
      renditionId: null,
    },
  };
}

describe("AI gallery statistics", () => {
  it("chooses the highest-rated non-voided round", () => {
    const entries = [
      entry(1, 6),
      entry(2, 9),
      entry(3, 10, { outcome: "voided" }),
    ];
    expect(criticChoice(entries)?.roundNo).toBe(2);
  });

  it("breaks rating ties in favor of the earliest round", () => {
    const entries = [entry(4, 9), entry(2, 9), entry(1, undefined)];
    expect(criticChoice(entries)?.roundNo).toBe(2);
  });

  it("counts only defined blind-guess and detective outcomes", () => {
    const entries = [
      entry(1, 7, { subject: true, detective: false }),
      entry(2, 8, { subject: true, detective: true }),
      entry(3, 5, { subject: false }),
      entry(4, undefined),
    ];
    expect(criticAccuracy(entries)).toEqual({
      subjectCorrect: 2,
      subjectTotal: 3,
      detectiveCorrect: 1,
      detectiveTotal: 2,
    });
  });
});
