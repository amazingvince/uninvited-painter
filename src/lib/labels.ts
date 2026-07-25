// User-facing labels that depend on room settings.
//
// These exist because the same sentence was being written per-screen from the
// default settings — "Both passes complete" in a three-pass room, "5 rounds"
// in a first-to-10 game. Any copy that names a number the host can change
// belongs here, so there is one place to be right.

import { SCORE_TARGET, type Settings } from "../../shared/types";

const PASS_WORD = ["", "One pass", "Two passes", "Three passes"];

/** "Two passes" — capitalised, for the head of a sentence. */
export function passesLabel(passes: number): string {
  return PASS_WORD[passes] ?? `${passes} passes`;
}

/** "Both passes complete" / "One pass complete" / "Three passes complete" */
export function passesCompleteLabel(passes: number): string {
  return `${passes === 2 ? "Both passes" : passesLabel(passes)} complete`;
}

/** How long the game runs: "5 rounds" or "First to 10". */
export function lengthLabel(
  settings: Pick<Settings, "winMode" | "rounds">,
): string {
  return settings.winMode === "score10"
    ? `First to ${SCORE_TARGET}`
    : `${settings.rounds} rounds`;
}

/** The round counter. A score game has no denominator to count towards. */
export function roundLabel(
  roundNo: number,
  settings: Pick<Settings, "winMode" | "rounds">,
): string {
  return settings.winMode === "score10"
    ? `Round ${roundNo} · first to ${SCORE_TARGET}`
    : `Round ${roundNo} / ${settings.rounds}`;
}

const NUMBER_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
];

/** Spelled-out small numbers; falls back to digits past the table. */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}
