import { AiProviderError } from "./ai-errors";
import {
  getSource,
  putJobResult,
  putRendition,
  type AiJobStoreEnv,
  type PostRoundAiPayload,
  type PostRoundAiResult,
} from "./ai-jobs";
import { requestCritic } from "./critic";
import { requestRendition } from "./rendition";
import {
  publishCompletedAiResult,
  type ArchiveEnv,
  type ArchiveKv,
} from "./archives";

export interface WorkflowStepConfigLike {
  retries?: {
    limit: number;
    delay: number | string;
    backoff?: "constant" | "linear" | "exponential";
  };
  timeout?: number | string;
}

export interface WorkflowStepLike {
  do<T>(
    name: string,
    config: WorkflowStepConfigLike,
    callback: () => Promise<T>,
  ): Promise<T>;
}

interface AiRoomCompletionStub {
  completeAiJob(result: PostRoundAiResult): Promise<void>;
}

export interface PostRoundWorkflowEnv extends AiJobStoreEnv {
  OPENAI_API_KEY?: string;
  OPENAI_CRITIC_MODEL?: string;
  ARCHIVES?: ArchiveKv;
  ROOM: {
    getByName(name: string): AiRoomCompletionStub;
  };
}

type CriticBranch =
  | {
      criticStatus: "ready";
      critic: NonNullable<PostRoundAiResult["critic"]>;
    }
  | { criticStatus: "unavailable"; critic: null };

type RenditionBranch =
  | { renditionStatus: "ready"; renditionId: string }
  | { renditionStatus: "unavailable"; renditionId: null };

async function runCriticBranch(
  env: PostRoundWorkflowEnv,
  payload: PostRoundAiPayload,
): Promise<CriticBranch> {
  if (!env.OPENAI_API_KEY) {
    return { criticStatus: "unavailable", critic: null };
  }
  const png = await getSource(env, payload.jobId);
  if (!png) return { criticStatus: "unavailable", critic: null };

  try {
    const critic = await requestCritic(
      {
        png,
        tone: payload.tone,
        criticEnabled: payload.criticEnabled,
        detectiveEnabled: payload.detectiveEnabled,
        artists: payload.artists,
      },
      {
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_CRITIC_MODEL,
      },
    );
    return { criticStatus: "ready", critic };
  } catch (error) {
    if (error instanceof AiProviderError && error.retryable) throw error;
    return { criticStatus: "unavailable", critic: null };
  }
}

async function runRenditionBranch(
  env: PostRoundWorkflowEnv,
  payload: PostRoundAiPayload,
): Promise<RenditionBranch> {
  if (!env.OPENAI_API_KEY) {
    return { renditionStatus: "unavailable", renditionId: null };
  }
  const png = await getSource(env, payload.jobId);
  if (!png) return { renditionStatus: "unavailable", renditionId: null };

  try {
    const jpeg = await requestRendition(
      { png, word: payload.word },
      { apiKey: env.OPENAI_API_KEY },
    );
    await putRendition(env, payload.jobId, jpeg);
    return { renditionStatus: "ready", renditionId: payload.jobId };
  } catch {
    return { renditionStatus: "unavailable", renditionId: null };
  }
}

export async function runPostRoundAi(
  env: PostRoundWorkflowEnv,
  payload: PostRoundAiPayload,
  step: WorkflowStepLike,
): Promise<PostRoundAiResult> {
  const criticPromise = step
    .do(
      "prepare critic",
      {
        retries: {
          limit: 1,
          delay: "2 seconds",
          backoff: "exponential",
        },
        timeout: "70 seconds",
      },
      () => runCriticBranch(env, payload),
    )
    .catch((): CriticBranch => ({
      criticStatus: "unavailable",
      critic: null,
    }));

  const renditionPromise = step
    .do(
      "generate rendition",
      {
        retries: { limit: 0, delay: 0 },
        timeout: "3 minutes",
      },
      () => runRenditionBranch(env, payload),
    )
    .catch((): RenditionBranch => ({
      renditionStatus: "unavailable",
      renditionId: null,
    }));

  const [critic, rendition] = await Promise.all([
    criticPromise,
    renditionPromise,
  ]);

  return step.do(
    "publish result",
    {
      retries: {
        limit: 3,
        delay: "2 seconds",
        backoff: "exponential",
      },
      timeout: "30 seconds",
    },
    async () => {
      const result: PostRoundAiResult = {
        jobId: payload.jobId,
        roundNo: payload.roundNo,
        ...critic,
        ...rendition,
        updatedAt: Date.now(),
      };
      await putJobResult(env, result);
      if (payload.mode === "online") {
        if (!payload.roomCode) throw new Error("Online AI job has no room");
        await env.ROOM.getByName(payload.roomCode).completeAiJob(result);
      }
      if (env.ARCHIVES) {
        await publishCompletedAiResult(env as ArchiveEnv, result);
      }
      return result;
    },
  );
}
