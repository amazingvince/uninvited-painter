// Worker entry: static app via assets, /api/* routed here (run_worker_first).
// A route resolves /api/rooms/:code/ws to that room's Durable Object and
// upgrades the socket.

import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "../shared/codes";
import { RoomDO } from "./room";

export { RoomDO };

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

    const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z]{4})(\/ws)?$/);
    if (match) {
      const code = normalizeRoomCode(match[1]);
      if (!isValidRoomCode(code)) {
        return new Response(JSON.stringify({ error: "Bad room code" }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }
      const stub = env.ROOM.getByName(code);
      if (match[2]) {
        return stub.fetch(request);
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

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
