// One mapping from a finished AI job onto reducer events, used by both the
// Durable Object (online) and the browser poller (local).
//
// These two used to map it independently and disagreed about failure: the DO
// retried a rejected RESOLVE as a FAIL, while local mode dropped the rejection,
// leaving "Luna is still deciding" on screen forever. A resolve that the engine
// refuses must always settle the branch — that is the rule, and it lives here.

import type { CriticVerdict, GameEvent } from "./types";

export interface AiJobOutcome {
  jobId: string;
  roundNo: number;
  criticStatus: "pending" | "ready" | "unavailable";
  critic: CriticVerdict | null;
  renditionStatus: "pending" | "ready" | "unavailable";
  renditionId: string | null;
}

/** The event to try first for each settled branch. */
export function aiResultEvents(result: AiJobOutcome): GameEvent[] {
  const events: GameEvent[] = [];
  if (result.criticStatus === "ready" && result.critic) {
    events.push({
      type: "RESOLVE_ROUND_CRITIC",
      roundNo: result.roundNo,
      jobId: result.jobId,
      verdict: result.critic,
    });
  } else if (result.criticStatus === "unavailable") {
    events.push({
      type: "FAIL_ROUND_CRITIC",
      roundNo: result.roundNo,
      jobId: result.jobId,
    });
  }
  if (result.renditionStatus === "ready" && result.renditionId) {
    events.push({
      type: "RESOLVE_ROUND_RENDITION",
      roundNo: result.roundNo,
      jobId: result.jobId,
      renditionId: result.renditionId,
    });
  } else if (result.renditionStatus === "unavailable") {
    events.push({
      type: "FAIL_ROUND_RENDITION",
      roundNo: result.roundNo,
      jobId: result.jobId,
    });
  }
  return events;
}

/** The settle-anyway event for a resolve the engine turned down. */
export function aiFallbackEvent(event: GameEvent): GameEvent | null {
  if (event.type === "RESOLVE_ROUND_CRITIC") {
    return { type: "FAIL_ROUND_CRITIC", roundNo: event.roundNo, jobId: event.jobId };
  }
  if (event.type === "RESOLVE_ROUND_RENDITION") {
    return { type: "FAIL_ROUND_RENDITION", roundNo: event.roundNo, jobId: event.jobId };
  }
  return null;
}
