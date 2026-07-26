/**
 * Runs the live critic against real finished drawings and reports the numbers
 * that reveal whether the prompt is working.
 *
 *   npx vite-node scripts/critic-eval.mts
 *   npx vite-node scripts/critic-eval.mts --tone savage --repeat 3
 *
 * Why this exists: every substantive problem with Luna was found by running
 * her against real games, and none of them by reading the prompt. The subject
 * guess was a sentence, so the "did she get it" mechanic could never fire. The
 * detective accused whoever drew most confidently, which is the opposite of a
 * faker. The rating restated the host's tone setting and nothing else. Banning
 * a stock phrase just moved the tic to another word. All of that is invisible
 * in a single sample and obvious in a table.
 *
 * It calls the real provider, so it costs money — nine text-only requests by
 * default, no image generation. Reads OPENAI_API_KEY from the environment,
 * falling back to .dev.vars or .env (both gitignored).
 *
 * Fixtures are three panels from a real published game. They are deliberately
 * a spread: Barbie reads clearly, Sleeping Beauty hides a castle and a bed in
 * a crowded field, Tarzan is a face that once tripped the provider's safety
 * filter.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { requestCritic } from "../worker/critic";
import { criticGuessMatches } from "../shared/fuzzy";
import type { AiTone, CriticVerdict } from "../shared/types";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const PANELS = [
  { word: "Sleeping Beauty", file: "sleeping-beauty-source.png" },
  { word: "Barbie", file: "barbie-source.png" },
  { word: "Tarzan", file: "tarzan-source.png" },
];

const ALL_TONES: AiTone[] = ["witty", "savage", "absurd"];

/** Phrases the model has reached for unprompted in past runs. A rise here
 *  means a banned word was replaced by a new crutch rather than removed. */
const CRUTCHES = [
  "chaos", "chaotic", "charming", "magnificent", "wonderfully", "delightful",
  "whimsical", "bold", "boldly", "baffling", "theatrical", "tangle", "collision",
  "fragmented", // emerged after "bold" was banned; watched, not banned — see below
];

/** Four anonymous seats, so the detective and callout have targets. */
const ARTISTS = [1, 2, 3, 4].map((n) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  color: ["#c2352b", "#1f6f4a", "#2f5d9e", "#8d610d"][n - 1],
}));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function apiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  for (const file of [".dev.vars", ".env"]) {
    const path = `${HERE}../${file}`;
    if (!existsSync(path)) continue;
    const found = readFileSync(path, "utf8").match(
      /OPENAI_API_KEY\s*=\s*"?([^"\n]+)"?/,
    );
    if (found) return found[1].trim();
  }
  throw new Error("No OPENAI_API_KEY in the environment, .dev.vars or .env");
}

interface Row {
  word: string;
  tone: AiTone;
  verdict?: CriticVerdict;
  error?: string;
}

function mean(values: number[]): number {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function group<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    out.set(k, [...(out.get(k) ?? []), row]);
  }
  return out;
}

function report(rows: Row[]): void {
  const ok = rows.filter((r): r is Row & { verdict: CriticVerdict } => !!r.verdict);
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);

  console.log("\n" + "=".repeat(78));
  console.log(
    `${pad("drawing", 17)}${pad("tone", 8)}${pad("rate", 6)}${pad("conf", 6)}${pad("guess", 22)}rating tag`,
  );
  for (const row of rows) {
    if (!row.verdict) {
      console.log(`${pad(row.word, 17)}${pad(row.tone, 8)}FAILED  ${row.error}`);
      continue;
    }
    const v = row.verdict;
    const hit = criticGuessMatches(v.subjectGuess ?? "", row.word) ? " ✓" : "";
    console.log(
      `${pad(row.word, 17)}${pad(row.tone, 8)}${pad(`${v.rating}/10`, 6)}` +
        `${pad(String(v.confidence ?? "-"), 6)}${pad((v.subjectGuess ?? "-") + hit, 22)}${v.ratingTag ?? "-"}`,
    );
  }

  if (ok.length === 0) {
    console.log("\nNo successful verdicts — nothing to measure.");
    return;
  }

  // The rating must vary with the drawing and NOT with the tone. When it was
  // unanchored the reverse was true: savage returned 5/10 six times of six.
  console.log("\n--- rating: should vary by drawing, not by tone ---");
  for (const [label, key] of [
    ["by tone   ", (r: Row) => r.tone],
    ["by drawing", (r: Row) => r.word],
  ] as const) {
    for (const [name, rowsIn] of group(ok, key)) {
      const ratings = rowsIn.map((r) => r.verdict.rating ?? 0);
      console.log(
        `  ${label} ${pad(name, 17)} ${JSON.stringify(ratings)}  spread=${Math.max(...ratings) - Math.min(...ratings)}`,
      );
    }
  }

  // Confidence should be higher on the legible drawing than the murky ones.
  console.log("\n--- confidence: should track legibility ---");
  for (const [name, rowsIn] of group(ok, (r) => r.word)) {
    const confs = rowsIn.map((r) => r.verdict.confidence ?? 0);
    console.log(`  ${pad(name, 17)} mean=${mean(confs).toFixed(1)}  ${JSON.stringify(confs)}`);
  }
  const singles = ok.filter((r) => (r.verdict.confidence ?? 100) < 25).length;
  if (singles) console.log(`  ⚠ ${singles} verdict(s) under 25 — check these are genuine, not a slipped digit`);

  // The guess has to be an answer, not a caption, or it can never match.
  console.log("\n--- subject guess ---");
  const lengths = ok.map((r) => (r.verdict.subjectGuess ?? "").length);
  const words = ok.map((r) => (r.verdict.subjectGuess ?? "").split(/\s+/).filter(Boolean).length);
  const hits = ok.filter((r) => criticGuessMatches(r.verdict.subjectGuess ?? "", r.word)).length;
  console.log(`  matched ${hits}/${ok.length}`);
  console.log(`  length  mean=${mean(lengths).toFixed(1)} max=${Math.max(...lengths)}`);
  console.log(`  words   mean=${mean(words).toFixed(1)} max=${Math.max(...words)}`);
  if (Math.max(...words) > 4) console.log("  ⚠ over four words — she is captioning, not guessing");

  // A crutch that vanishes usually reappears as a different word.
  console.log("\n--- stock phrasing ---");
  const prose = ok
    .map((r) => `${r.verdict.ratingTag ?? ""} ${r.verdict.review ?? ""} ${r.verdict.callout?.text ?? ""}`)
    .join(" ")
    .toLowerCase();
  const found = CRUTCHES.map((w) => [w, (prose.match(new RegExp(`\\b${w}`, "g")) ?? []).length] as const)
    .filter(([, n]) => n > 0);
  console.log(found.length ? `  ${found.map(([w, n]) => `${w}×${n}`).join("  ")}` : "  none of the known crutches");
  const tags = ok.map((r) => (r.verdict.ratingTag ?? "").toLowerCase());
  const repeats = [...group(tags, (t) => t)].filter(([, v]) => v.length > 1);
  if (repeats.length) console.log(`  ⚠ repeated rating tags: ${repeats.map(([t]) => `"${t}"`).join(", ")}`);

  const failed = rows.length - ok.length;
  if (failed) console.log(`\n⚠ ${failed}/${rows.length} calls failed — see the table above`);
}

const tone = arg("tone") as AiTone | undefined;
const tones = tone ? [tone] : ALL_TONES;
const repeat = Number(arg("repeat") ?? 1);
const key = apiKey();
const rows: Row[] = [];

console.log(`Running ${PANELS.length * tones.length * repeat} live critic calls (text only)…`);

for (let pass = 0; pass < repeat; pass++) {
  for (const [index, panel] of PANELS.entries()) {
    const bytes = readFileSync(`${HERE}fixtures/${panel.file}`);
    const png = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    for (const t of tones) {
      try {
        const verdict = await requestCritic(
          {
            png,
            tone: t,
            criticEnabled: true,
            detectiveEnabled: true,
            artists: ARTISTS,
            // Rotates the angle and callout target exactly as a real game does.
            roundNo: index + 1 + pass * PANELS.length,
          },
          { apiKey: key },
        );
        rows.push({ word: panel.word, tone: t, verdict });
      } catch (error) {
        rows.push({ word: panel.word, tone: t, error: String(error) });
      }
    }
  }
}

report(rows);
