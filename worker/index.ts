// Worker entry: static app via assets; /api/*, /r/* and /a/* run here first
// (game API, room resolution, and og-tag injection for link previews).

import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "../shared/codes";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { PostRoundAiPayload, PostRoundAiResult } from "./ai-jobs";
import {
  handleAiRendition,
  handleAiStatus,
  handleLocalAiPost,
  handleOnlineAiPost,
} from "./ai-routes";
import { handleArchiveGet, handleArchiveImage, handleArchivePost, getArchive } from "./archives";
import { archiveTags, roomTags, serveShellWithOg } from "./og";
import {
  runPostRoundAi,
  type PostRoundWorkflowEnv,
  type WorkflowStepLike,
} from "./post-round-workflow";
import { RoomDO } from "./room";

export { RoomDO };

export class PostRoundAiWorkflow extends WorkflowEntrypoint<
  Env,
  PostRoundAiPayload
> {
  override run(
    event: Readonly<WorkflowEvent<PostRoundAiPayload>>,
    step: WorkflowStep,
  ): Promise<PostRoundAiResult> {
    return runPostRoundAi(
      this.env as unknown as PostRoundWorkflowEnv,
      event.payload,
      step as unknown as WorkflowStepLike,
    );
  }
}

const JSON_HEADERS = { "content-type": "application/json" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateRoomCode();
        const stub = env.ROOM.getByName(code);
        if (await stub.create(code)) {
          return new Response(JSON.stringify({ code }), { headers: JSON_HEADERS });
        }
      }
      return new Response(JSON.stringify({ error: "Could not find a free room" }), {
        status: 503,
        headers: JSON_HEADERS,
      });
    }

    if (url.pathname === "/api/archives" && request.method === "POST") {
      return handleArchivePost(request, env);
    }
    if (url.pathname === "/api/ai/jobs" && request.method === "POST") {
      return handleLocalAiPost(request, env);
    }
    const aiJobApi = url.pathname.match(
      /^\/api\/ai\/jobs\/([A-Za-z0-9-]{1,64})$/,
    );
    if (aiJobApi && request.method === "GET") {
      return handleAiStatus(env, aiJobApi[1]);
    }
    const aiRenditionApi = url.pathname.match(
      /^\/api\/ai\/renditions\/([A-Za-z0-9-]{1,64})$/,
    );
    if (aiRenditionApi && request.method === "GET") {
      return handleAiRendition(env, aiRenditionApi[1]);
    }
    const archiveApi = url.pathname.match(/^\/api\/archives\/([A-Za-z0-9]{1,32})(\/og\.png)?$/);
    if (archiveApi && (request.method === "GET" || request.method === "HEAD")) {
      return archiveApi[2]
        ? handleArchiveImage(env, archiveApi[1])
        : handleArchiveGet(env, archiveApi[1]);
    }

    const roomApi = url.pathname.match(
      /^\/api\/rooms\/([A-Za-z]{4})(\/ws|\/ai)?$/,
    );
    if (roomApi) {
      const code = normalizeRoomCode(roomApi[1]);
      if (!isValidRoomCode(code)) {
        return new Response(JSON.stringify({ error: "Bad room code" }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }
      const stub = env.ROOM.getByName(code);
      if (roomApi[2] === "/ws") {
        return stub.fetch(request);
      }
      if (roomApi[2] === "/ai") {
        return request.method === "POST"
          ? handleOnlineAiPost(request, env, code)
          : new Response(JSON.stringify({ error: "Method not allowed" }), {
              status: 405,
              headers: JSON_HEADERS,
            });
      }
      const summary = await stub.summary();
      if (!summary) {
        return new Response(JSON.stringify({ exists: false }), {
          status: 404,
          headers: JSON_HEADERS,
        });
      }
      return new Response(JSON.stringify(summary), { headers: JSON_HEADERS });
    }

    // Unmatched API paths stay API errors — never the SPA shell.
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }

    // App routes that want og tags for link-preview crawlers.
    const roomPage = url.pathname.match(/^\/r\/([A-Za-z]{4})$/);
    if (roomPage && (request.method === "GET" || request.method === "HEAD")) {
      return serveShellWithOg(request, env, roomTags(url.origin, normalizeRoomCode(roomPage[1])));
    }
    const archivePage = url.pathname.match(/^\/a\/([a-z2-9]{12})$/);
    if (archivePage && (request.method === "GET" || request.method === "HEAD")) {
      const archive = await getArchive(env, archivePage[1]);
      if (archive) {
        return serveShellWithOg(
          request,
          env,
          archiveTags(url.origin, archivePage[1], archive.title, archive.entries.length, archive.hasImage),
        );
      }
    }

    // Anything else under run_worker_first falls through to the assets binding
    // (SPA fallback serves the shell).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
