// One definition of what a critic verdict may contain.
//
// Four places used to enforce this contract with four private copies of the
// same magic numbers: the engine (trusting a reducer event), the AI job store
// (trusting R2), the archive endpoint (trusting an upload), and the provider
// client (trusting the model, plus a JSON schema built from the same limits).
// Any drift between them meant a verdict that one layer accepted and the next
// silently discarded — with a paid API call already spent.

import type { CriticVerdict } from "./types";

export const VERDICT_LIMITS = {
  title: 80,
  // Deliberately tight. At 100 the model answered with a sentence describing
  // the scene ("A neighborhood map with a house, a person and a winding
  // route") instead of naming one thing, and a description can never match a
  // one-word answer — measured 0/9 against real games. The strict schema
  // carries this ceiling to the model, so the limit is the instruction.
  subjectGuess: 48,
  ratingTag: 60,
  review: 360,
  callout: 180,
  detective: 180,
  playerId: 100,
} as const;

export const VERDICT_KEYS = [
  "title",
  "subjectGuess",
  "confidence",
  "rating",
  "ratingTag",
  "review",
  "callout",
  "detective",
] as const;

export const RATING_RANGE = { min: 1, max: 10 } as const;
export const CONFIDENCE_RANGE = { min: 0, max: 100 } as const;

export interface VerdictRules {
  /**
   * "strict" (default) rejects text over the limit — the right policy for a
   * hostile client or a corrupt store. "coerce" collapses whitespace and
   * truncates instead, which is what the model boundary wants: a title two
   * characters long shouldn't bin a verdict that was already paid for.
   */
  mode?: "strict" | "coerce";
  /** Ids the callout and detective may name. Omit to skip the check. */
  eligibleIds?: Set<string>;
  /** The room asked for a critic, so the critic fields are mandatory. */
  requireCritic?: boolean;
  /** The room asked for a detective, so that section is mandatory. */
  requireDetective?: boolean;
}

function text(
  value: unknown,
  max: number,
  mode: "strict" | "coerce" = "strict",
): string | null {
  if (typeof value !== "string") return null;
  if (mode === "coerce") {
    const collapsed = value.replace(/\s+/g, " ").trim();
    return collapsed ? collapsed.slice(0, max).trimEnd() : null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function integerIn(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function attribution(
  value: unknown,
  key: "text" | "reason",
  eligibleIds: Set<string> | undefined,
  mode: "strict" | "coerce",
): { playerId: string; body: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const playerId = text(item.playerId, VERDICT_LIMITS.playerId, mode);
  const body = text(
    item[key],
    VERDICT_LIMITS[key === "text" ? "callout" : "detective"],
    mode,
  );
  if (!playerId || !body) return null;
  if (eligibleIds && !eligibleIds.has(playerId)) return null;
  return { playerId, body };
}

/**
 * Returns a cleaned verdict, or a reason string explaining the rejection.
 * Callers decide what to do with the reason — the engine fails the event, the
 * stores treat it as corrupt, the provider client retries or gives up.
 */
export function parseCriticVerdict(
  raw: unknown,
  rules: VerdictRules = {},
): CriticVerdict | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "Bad critic verdict";
  }
  const input = raw as Record<string, unknown>;
  const mode = rules.mode ?? "strict";
  for (const key of Object.keys(input)) {
    if (!(VERDICT_KEYS as readonly string[]).includes(key)) {
      return `Unexpected critic field ${key}`;
    }
  }

  const clean: CriticVerdict = {};

  for (const field of ["title", "subjectGuess", "ratingTag", "review"] as const) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    const cleaned = text(value, VERDICT_LIMITS[field], mode);
    if (!cleaned) return `Bad critic ${field}`;
    clean[field] = cleaned;
  }

  if (input.confidence !== undefined && input.confidence !== null) {
    if (!integerIn(input.confidence, CONFIDENCE_RANGE.min, CONFIDENCE_RANGE.max)) {
      return "Bad critic confidence";
    }
    clean.confidence = input.confidence as number;
  }
  if (input.rating !== undefined && input.rating !== null) {
    if (!integerIn(input.rating, RATING_RANGE.min, RATING_RANGE.max)) {
      return "Bad critic rating";
    }
    clean.rating = input.rating as number;
  }

  if (input.callout !== undefined && input.callout !== null) {
    const parsed = attribution(input.callout, "text", rules.eligibleIds, mode);
    // A callout naming someone who has since been dropped is dropped with
    // them — it is decoration, and binning the whole verdict over it would
    // throw away the review as well.
    if (parsed) clean.callout = { playerId: parsed.playerId, text: parsed.body };
  }

  if (input.detective !== undefined && input.detective !== null) {
    const parsed = attribution(input.detective, "reason", rules.eligibleIds, mode);
    // Same rule as the callout: an accusation naming someone who has since
    // been dropped goes with them rather than binning the title, subject
    // guess, rating and review alongside it. `requireDetective` below still
    // catches a provider that simply failed to produce one.
    if (parsed) clean.detective = { playerId: parsed.playerId, reason: parsed.body };
  }

  if (rules.requireCritic) {
    if (
      !clean.title ||
      !clean.subjectGuess ||
      clean.confidence === undefined ||
      clean.rating === undefined ||
      !clean.ratingTag ||
      !clean.review
    ) {
      return "Incomplete critic verdict";
    }
  }
  if (rules.requireDetective && !clean.detective) {
    return "Incomplete detective verdict";
  }
  if (Object.keys(clean).length === 0) return "Empty critic verdict";
  return clean;
}
