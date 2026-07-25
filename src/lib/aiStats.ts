import type { ArchiveEntry } from "../../shared/types";

export function criticChoice(
  entries: ArchiveEntry[],
): ArchiveEntry | undefined {
  return entries
    .filter(
      (entry) =>
        entry.outcome !== "voided" &&
        entry.ai?.criticStatus === "ready" &&
        Number.isInteger(entry.ai.critic?.rating),
    )
    .sort((left, right) => {
      const ratingDelta =
        (right.ai?.critic?.rating ?? 0) - (left.ai?.critic?.rating ?? 0);
      return ratingDelta || left.roundNo - right.roundNo;
    })[0];
}

export function criticAccuracy(entries: ArchiveEntry[]): {
  subjectCorrect: number;
  subjectTotal: number;
  detectiveCorrect: number;
  detectiveTotal: number;
} {
  let subjectCorrect = 0;
  let subjectTotal = 0;
  let detectiveCorrect = 0;
  let detectiveTotal = 0;
  for (const entry of entries) {
    if (entry.criticSubjectMatched !== undefined) {
      subjectTotal += 1;
      if (entry.criticSubjectMatched) subjectCorrect += 1;
    }
    if (entry.criticDetectiveMatched !== undefined) {
      detectiveTotal += 1;
      if (entry.criticDetectiveMatched) detectiveCorrect += 1;
    }
  }
  return {
    subjectCorrect,
    subjectTotal,
    detectiveCorrect,
    detectiveTotal,
  };
}
