import { activeArtists, aiEnabled } from "../../shared/engine";
import type {
  GameEvent,
  RoomState,
  RoundAi,
} from "../../shared/types";
import type { PostRoundAiResult } from "../../worker/ai-jobs";
import { roomToken } from "./storage";

export interface LocalAiRequestMeta {
  jobId: string;
  roundNo: number;
  word: string;
  aiCritic: boolean;
  aiDetective: boolean;
  aiTone: RoomState["settings"]["aiTone"];
  artists: { id: string; colorIndex: number }[];
}

export class PostRoundAiUploadError extends Error {
  constructor(readonly retryable: boolean) {
    super("Could not upload the round for AI");
  }
}

export function shouldStartLocalAi(state: RoomState): boolean {
  const round = state.round;
  return (
    state.phase === "voting" &&
    !!round &&
    round.outcome !== "voided" &&
    aiEnabled(state.settings) &&
    round.ai.jobId === null
  );
}

export function shouldPollLocalAi(ai: RoundAi): boolean {
  return (
    ai.jobId !== null &&
    (ai.criticStatus === "pending" || ai.renditionStatus === "pending")
  );
}

export function localAiRequestMeta(
  state: RoomState,
  jobId: string,
): LocalAiRequestMeta {
  const round = state.round;
  if (!round) throw new Error("No round for AI");
  return {
    jobId,
    roundNo: round.roundNo,
    word: round.word,
    aiCritic: state.settings.aiCritic,
    aiDetective: state.settings.aiDetective,
    aiTone: state.settings.aiTone,
    artists: activeArtists(round).map((id) => {
      const player = state.players.find((candidate) => candidate.id === id);
      if (!player) throw new Error("Missing AI artist");
      return { id, colorIndex: player.colorIndex };
    }),
  };
}

export function buildOnlineAiForm(
  token: string,
  roundNo: number,
  png: Blob,
): FormData {
  const form = new FormData();
  form.append("token", token);
  form.append("roundNo", String(roundNo));
  form.append("image", png, "drawing.png");
  return form;
}

export async function startLocalAiJob(
  state: RoomState,
  jobId: string,
  png: Blob,
): Promise<PostRoundAiResult> {
  const form = new FormData();
  form.append("meta", JSON.stringify(localAiRequestMeta(state, jobId)));
  form.append("image", png, "drawing.png");
  const response = await fetch("/api/ai/jobs", { method: "POST", body: form });
  if (response.status !== 200 && response.status !== 202) {
    throw new Error("Could not start the post-round AI");
  }
  return response.json() as Promise<PostRoundAiResult>;
}

export async function getLocalAiJob(
  jobId: string,
): Promise<PostRoundAiResult> {
  const response = await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("AI result is not available yet");
  return response.json() as Promise<PostRoundAiResult>;
}

export async function uploadOnlineAiSource(
  code: string,
  roundNo: number,
  png: Blob,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/rooms/${code}/ai`, {
      method: "POST",
      body: buildOnlineAiForm(roomToken(code), roundNo, png),
    });
  } catch {
    throw new PostRoundAiUploadError(true);
  }
  if (![200, 202, 409].includes(response.status)) {
    throw new PostRoundAiUploadError(false);
  }
}

export function aiResultEvents(result: PostRoundAiResult): GameEvent[] {
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
