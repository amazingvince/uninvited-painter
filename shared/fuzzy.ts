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

function stripPlural(word: string): string {
  if (word.length > 3 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s")) return word.slice(0, -1);
  return word;
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

export function guessMatches(guess: string, word: string): boolean {
  const g = normalize(guess);
  const w = normalize(word);
  if (!g || !w) return false;
  if (g === w) return true;
  const gs = stripPlural(g);
  const ws = stripPlural(w);
  if (gs === ws) return true;
  // One letter's slip — a bit more slack for long, multi-word answers (movies).
  const max = w.length >= 10 ? 2 : 1;
  return editDistanceAtMost(gs, ws, max);
}
