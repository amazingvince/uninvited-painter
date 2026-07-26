// Fuzzy guess matching: plurals and a letter's slip are forgiven.
// Matching happens server-side in online mode — the word never ships to the fake.

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

export const GUESS_MAX_LENGTH = 60;

/** The authoritative text used for both matching and the eventual reveal. */
export function prepareGuessSubmission(
  raw: unknown,
  word: string,
): { text: string; matched: boolean } {
  const text = String(raw ?? "").trim().slice(0, GUESS_MAX_LENGTH);
  return { text, matched: guessMatches(text, word) };
}

/**
 * Candidate singulars, because "-ies" and "-es" are ambiguous.
 *
 * "puppies" comes from "puppy" but "barbies" comes from "barbie", and picking
 * one rule silently fails the other — this module promises plurals are
 * forgiven, and "barbies" against "Barbie" did not match. Trying both costs a
 * couple of comparisons.
 */
function singulars(word: string): string[] {
  const out = [word];
  if (word.length > 3 && word.endsWith("ies")) {
    out.push(word.slice(0, -3) + "y", word.slice(0, -1));
  } else if (word.length > 3 && word.endsWith("es")) {
    out.push(word.slice(0, -2), word.slice(0, -1));
  } else if (word.length > 2 && word.endsWith("s")) {
    out.push(word.slice(0, -1));
  }
  return out;
}

/** Levenshtein distance, early-exiting once it exceeds `max`. */
function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > max) return false;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length] <= max;
}

/**
 * Did the critic land on the word? Looser than the human matcher on purpose.
 *
 * The fake artist types one answer and either has it or does not, so that
 * comparison stays exact-ish. Luna answers in her own voice — "a barbie doll",
 * "some kind of castle" — and refusing those would mean her guess never counts
 * for anything, which is what happened before this existed. So the word may
 * sit anywhere inside her phrase, on a word boundary.
 */
export function criticGuessMatches(guess: string, word: string): boolean {
  if (guessMatches(guess, word)) return true;
  const w = normalize(word);
  if (!w) return false;
  // Compare token runs so a multi-word word ("sleeping beauty") still matches
  // inside a longer phrase, without matching a stray substring ("art" in
  // "cartoon").
  const wordTokens = word.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  const guessTokens = guess.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  if (wordTokens.length === 0 || guessTokens.length < wordTokens.length) return false;
  for (let i = 0; i + wordTokens.length <= guessTokens.length; i++) {
    const window = guessTokens.slice(i, i + wordTokens.length).join(" ");
    if (guessMatches(window, word)) return true;
  }
  return false;
}

export function guessMatches(guess: string, word: string): boolean {
  const g = normalize(guess);
  const w = normalize(word);
  if (!g || !w) return false;
  if (g === w) return true;
  // Digits are never a slip. "Jaws 2" is a different film from "Jaws", and a
  // single-character edit budget would otherwise let a sequel number pass.
  if (g.replace(/\D/g, "") !== w.replace(/\D/g, "")) return false;
  // One letter's slip — a bit more slack for long, multi-word answers (movies).
  const max = w.length >= 10 ? 2 : 1;
  for (const gs of singulars(g)) {
    for (const ws of singulars(w)) {
      if (gs === ws || editDistanceAtMost(gs, ws, max)) return true;
    }
  }
  return false;
}
