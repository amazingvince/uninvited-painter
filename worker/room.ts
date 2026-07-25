// One Durable Object per room, keyed by the 4-letter code. Holds the
// authoritative state and the WebSocket set. Turn order, undo eligibility and
// vote sealing are all enforced here — the client never decides. On reconnect
// the DO replays committed strokes as one snapshot (the state broadcast).

import { DurableObject } from "cloudflare:workers";
import { createRoom, isGameOver, normalizeRoom, reduce } from "../shared/engine";
import { prepareRoundEvent, redrawWordEvent } from "../shared/decks";
import { guessMatches } from "../shared/fuzzy";
import { redactState, type ClientMsg, type ServerMsg } from "../shared/protocol";
import { ROOM_TTL_MS, type GameEvent, type RoomState } from "../shared/types";

interface Attachment {
  token: string;
  playerId: string | null;
}

export class RoomDO extends DurableObject<Env> {
  private cached: RoomState | null | undefined;
  /** Ephemeral per-turn budget for the live relay (resets with the instance —
   *  hibernation wiping it just refills the bucket, which is harmless). */
  private liveBudget: { turnKey: string; coords: number } = { turnKey: "", coords: 0 };

  // -------------------------------------------------------------------------
  // RPC (called from the Worker)
  // -------------------------------------------------------------------------

  /** Claim this code for a fresh room. Returns false if the room is in use. */
  async create(code: string): Promise<boolean> {
    const existing = await this.getState();
    if (existing !== null) return false;
    const state = createRoom({ code, mode: "online", hostId: "" });
    await this.persist(state);
    // A room nobody ever joins still gets cleaned up.
    await this.ctx.storage.put("emptySince", Date.now());
    await this.syncAlarm();
    return true;
  }

  async summary(): Promise<{ exists: boolean; phase: string; players: number } | null> {
    const state = await this.getState();
    if (!state) return null;
    return { exists: true, phase: state.phase, players: state.players.length };
  }

  // -------------------------------------------------------------------------
  // WebSocket upgrade
  // -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const state = await this.getState();
    if (!state) {
      return new Response("Room not found", { status: 404 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token: "", playerId: null } satisfies Attachment);
    // A fresh socket gets the lobby picture right away (player list, taken
    // colours, settings) so the join screen can render before joining.
    const view = redactState(state, "");
    this.send(server, { t: "state", state: view.state, you: view.you });
    await this.ctx.storage.delete("emptySince");
    await this.syncAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  // -------------------------------------------------------------------------
  // WebSocket handlers (hibernation API)
  // -------------------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.sendError(ws, "Bad message");
    }
    const state = await this.getState();
    if (!state) {
      this.sendError(ws, "This room has closed");
      ws.close(1000, "gone");
      return;
    }
    const attach = (ws.deserializeAttachment() ?? { token: "", playerId: null }) as Attachment;

    try {
      switch (msg.t) {
        case "join":
          return await this.handleJoin(ws, msg.token, msg.name, msg.colorIndex);
        case "rejoin":
          return await this.handleRejoin(ws, msg.token);
        default:
          break;
      }

      const playerId = attach.playerId;
      if (!playerId) return this.sendError(ws, "Join first");
      const now = Date.now();
      const isHost = state.hostId === playerId;
      const round = state.round;

      switch (msg.t) {
        case "rename":
          return await this.dispatch(ws, { type: "RENAME_PLAYER", playerId, name: msg.name });
        case "setColor":
          return await this.dispatch(ws, { type: "SET_COLOR", playerId, colorIndex: msg.colorIndex });
        case "settings":
          if (!isHost) return this.sendError(ws, "Host only");
          return await this.dispatch(ws, { type: "SET_SETTINGS", settings: msg.settings });
        case "houseWords": {
          if (msg.remove) {
            return await this.dispatch(ws, {
              type: "REMOVE_HOUSE_WORD",
              playerId,
              word: String(msg.remove).slice(0, 64),
            });
          }
          if (!Array.isArray(msg.add) || msg.add.length === 0) return;
          return await this.dispatch(ws, {
            type: "ADD_HOUSE_WORDS",
            playerId,
            words: msg.add.slice(0, 20).map((w) => String(w).slice(0, 64)),
          });
        }
        case "start": {
          if (!isHost) return this.sendError(ws, "Host only");
          if (state.phase !== "lobby") return this.sendError(ws, "Already underway");
          return await this.dispatch(ws, prepareRoundEvent(state));
        }
        case "redraw": {
          if (round?.qmId !== playerId) return this.sendError(ws, "Question master only");
          return await this.dispatch(ws, redrawWordEvent(state));
        }
        case "deal":
          if (round?.qmId !== playerId) return this.sendError(ws, "Question master only");
          return await this.dispatch(ws, { type: "DEAL", now });
        case "seen":
          return await this.dispatch(ws, { type: "MARK_SEEN", playerId, now });
        case "live": {
          // Ephemeral in-progress stroke — relayed, never stored.
          if (!Array.isArray(msg.points) || msg.points.length > 512) return;
          if (!msg.points.every((n) => typeof n === "number" && n >= -0.01 && n <= 1.01)) return;
          if (state.phase !== "drawing" || !round) return;
          if (round.schedule[round.turnIndex] !== playerId) return;
          if (Object.keys(state.holds).length > 0) return;
          // Cumulative cap per turn — a hostile drawer can't firehose the room.
          const turnKey = `${round.roundNo}:${round.turnIndex}`;
          if (this.liveBudget.turnKey !== turnKey) {
            this.liveBudget = { turnKey, coords: 0 };
          }
          if (this.liveBudget.coords > 12_000) return;
          this.liveBudget.coords += msg.points.length;
          const player = state.players.find((p) => p.id === playerId);
          if (!player) return;
          this.broadcastRaw(
            {
              t: "live",
              playerId,
              colorIndex: player.colorIndex,
              points: msg.points,
              ...(msg.newSegment ? { newSegment: true } : {}),
            },
            playerId,
          );
          return;
        }
        case "liveClear":
          this.broadcastRaw({ t: "liveClear", playerId }, playerId);
          return;
        case "commit":
          return await this.dispatch(ws, {
            type: "COMMIT_STROKE",
            playerId,
            points: msg.points,
            breaks: Array.isArray(msg.breaks) ? msg.breaks.slice(0, 32) : undefined,
            now,
          });
        case "vote":
          return await this.dispatch(ws, { type: "CAST_VOTE", voterId: playerId, targetId: msg.targetId, now });
        case "guess": {
          if (!round) return this.sendError(ws, "No round");
          const text = String(msg.text ?? "").slice(0, 200);
          const matched = guessMatches(text, round.word);
          return await this.dispatch(ws, { type: "SUBMIT_GUESS", playerId, text, matched });
        }
        case "next": {
          if (!isHost) return this.sendError(ws, "Host only");
          if (state.phase !== "reveal") return this.sendError(ws, "Not at a reveal");
          const voided = round?.outcome === "voided";
          if (!voided && isGameOver(state)) {
            return await this.dispatch(ws, { type: "CLOSE_GAME" });
          }
          return await this.dispatch(ws, prepareRoundEvent(state));
        }
        case "again":
          if (!isHost) return this.sendError(ws, "Host only");
          return await this.dispatch(ws, { type: "PLAY_AGAIN" });
        case "dropPlayer": {
          if (!isHost) return this.sendError(ws, "Host only");
          if (msg.playerId === playerId) return this.sendError(ws, "Use leave for yourself");
          if (state.phase === "lobby") {
            // In the lobby a "drop" is a removal — lets the host clear seats
            // whose owners closed the tab and will never send leave.
            await this.dispatch(ws, { type: "REMOVE_PLAYER", playerId: msg.playerId });
            const tokens = await this.getTokens();
            for (const [tok, id] of Object.entries(tokens)) {
              if (id === msg.playerId) delete tokens[tok];
            }
            await this.ctx.storage.put("tokens", tokens);
            return;
          }
          if (round && msg.playerId === round.fakeId) {
            return await this.dispatch(ws, { type: "VOID_ROUND" });
          }
          // If the round can't continue without them (too few artists left),
          // fall back to voiding it — same rule the auto-drop alarm applies.
          const result = reduce(state, { type: "DROP_PLAYER", playerId: msg.playerId, now });
          if (!result.ok) {
            return await this.dispatch(ws, { type: "VOID_ROUND" });
          }
          await this.persistAndBroadcast(result.state);
          return;
        }
        case "leave": {
          if (state.phase === "lobby") {
            await this.dispatch(ws, { type: "REMOVE_PLAYER", playerId });
            const tokens = await this.getTokens();
            for (const [tok, id] of Object.entries(tokens)) {
              if (id === playerId) delete tokens[tok];
            }
            await this.ctx.storage.put("tokens", tokens);
          }
          ws.close(1000, "left");
          return;
        }
        default:
          return this.sendError(ws, "Unknown message");
      }
    } catch (err) {
      this.sendError(ws, "Something went wrong");
      console.error("webSocketMessage error", err);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleGone(ws);
  }

  private async handleGone(ws: WebSocket): Promise<void> {
    const attach = (ws.deserializeAttachment() ?? { token: "", playerId: null }) as Attachment;
    const state = await this.getState();
    const stillHere = this.socketsFor(attach.playerId, ws).length > 0;
    if (state && attach.playerId && !stillHere) {
      const result = reduce(state, {
        type: "SET_CONNECTED",
        playerId: attach.playerId,
        connected: false,
        now: Date.now(),
      });
      if (result.ok) await this.persistAndBroadcast(result.state);
    }
    if (state && this.liveSockets(ws).length === 0) {
      await this.ctx.storage.put("emptySince", Date.now());
    }
    await this.syncAlarm();
  }

  // -------------------------------------------------------------------------
  // Alarm: guess timeouts, seat-hold expiries, empty-room cleanup
  // -------------------------------------------------------------------------

  async alarm(): Promise<void> {
    let state = await this.getState();
    if (!state) return;
    const now = Date.now();

    const emptySince = await this.ctx.storage.get<number>("emptySince");
    if (
      emptySince !== undefined &&
      this.liveSockets().length === 0 &&
      now >= emptySince + ROOM_TTL_MS
    ) {
      // Rooms stay warm for 15 minutes after the last player leaves — then gone.
      await this.ctx.storage.deleteAll();
      this.cached = undefined;
      return;
    }

    let changed = false;
    // Expired seat holds: the round continues without them — unless the fake
    // artist dropped, in which case the round is voided and re-dealt.
    for (const [playerId, deadline] of Object.entries(state.holds)) {
      if (deadline > now) continue;
      const event: GameEvent =
        state.round && playerId === state.round.fakeId
          ? { type: "VOID_ROUND" }
          : { type: "DROP_PLAYER", playerId, now };
      let result = reduce(state, event);
      if (!result.ok && event.type === "DROP_PLAYER") {
        result = reduce(state, { type: "VOID_ROUND" });
      }
      if (result.ok) {
        state = result.state;
        changed = true;
      } else {
        // Cannot drop (e.g. between rounds) — release the hold.
        state = { ...state, holds: { ...state.holds } };
        delete state.holds[playerId];
        changed = true;
      }
    }

    if (state.phase === "guessing" && state.round?.guessDeadline != null) {
      if (state.round.guessDeadline <= now && Object.keys(state.holds).length === 0) {
        const result = reduce(state, { type: "GUESS_TIMEOUT", now });
        if (result.ok) {
          state = result.state;
          changed = true;
        }
      }
    }

    // Stroke clock: forfeit an idle drawing turn / close an overdue ballot.
    if (
      (state.phase === "drawing" || state.phase === "voting") &&
      state.round?.turnDeadline != null &&
      state.round.turnDeadline <= now &&
      Object.keys(state.holds).length === 0
    ) {
      const result = reduce(state, { type: "TURN_TIMEOUT", now });
      if (result.ok) {
        state = result.state;
        changed = true;
      }
    }

    if (changed) await this.persistAndBroadcast(state);
    await this.syncAlarm();
  }

  // -------------------------------------------------------------------------
  // Join / rejoin
  // -------------------------------------------------------------------------

  private async handleJoin(
    ws: WebSocket,
    token: string,
    name: string,
    colorIndex: number,
  ): Promise<void> {
    if (!token || typeof token !== "string" || token.length > 64) {
      return this.sendError(ws, "Bad token");
    }
    const tokens = await this.getTokens();
    if (tokens[token]) return this.handleRejoin(ws, token);

    const state = (await this.getState())!;
    const playerId = crypto.randomUUID();
    const result = reduce(state, {
      type: "ADD_PLAYER",
      player: { id: playerId, name, colorIndex },
    });
    if (!result.ok) return this.sendError(ws, result.error);

    tokens[token] = playerId;
    await this.ctx.storage.put("tokens", tokens);
    ws.serializeAttachment({ token, playerId } satisfies Attachment);
    this.send(ws, { t: "joined", playerId });
    await this.persistAndBroadcast(result.state);
    await this.syncAlarm();
  }

  private async handleRejoin(ws: WebSocket, token: string): Promise<void> {
    const tokens = await this.getTokens();
    const playerId = tokens[token];
    const state = (await this.getState())!;
    const player = state.players.find((p) => p.id === playerId);
    if (!playerId || !player) return this.sendError(ws, "No seat to rejoin — join fresh");
    ws.serializeAttachment({ token, playerId } satisfies Attachment);
    this.send(ws, { t: "joined", playerId });
    const result = reduce(state, {
      type: "SET_CONNECTED",
      playerId,
      connected: true,
      now: Date.now(),
    });
    await this.persistAndBroadcast(result.ok ? result.state : state);
    await this.syncAlarm();
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private async getState(): Promise<RoomState | null> {
    if (this.cached === undefined) {
      const stored = (await this.ctx.storage.get<RoomState>("state")) ?? null;
      // Rooms persisted before a deploy may predate newer fields.
      this.cached = stored ? normalizeRoom(stored) : null;
    }
    return this.cached;
  }

  private async getTokens(): Promise<Record<string, string>> {
    return (await this.ctx.storage.get<Record<string, string>>("tokens")) ?? {};
  }

  private async persist(state: RoomState): Promise<void> {
    this.cached = state;
    await this.ctx.storage.put("state", state);
  }

  private async persistAndBroadcast(state: RoomState): Promise<void> {
    await this.persist(state);
    for (const socket of this.liveSockets()) {
      const attach = (socket.deserializeAttachment() ?? { playerId: null }) as Attachment;
      const view = redactState(state, attach.playerId ?? "");
      this.send(socket, { t: "state", state: view.state, you: view.you });
    }
    await this.syncAlarm();
  }

  /** Dispatch an event through the shared reducer; on success persist + broadcast. */
  private async dispatch(ws: WebSocket, event: GameEvent): Promise<void> {
    const state = (await this.getState())!;
    const result = reduce(state, event);
    if (!result.ok) return this.sendError(ws, result.error);
    await this.persistAndBroadcast(result.state);
  }

  private liveSockets(except?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((s) => s !== except && s.readyState === WebSocket.READY_STATE_OPEN);
  }

  private socketsFor(playerId: string | null, except?: WebSocket): WebSocket[] {
    if (!playerId) return [];
    return this.liveSockets(except).filter((s) => {
      const attach = (s.deserializeAttachment() ?? { playerId: null }) as Attachment;
      return attach.playerId === playerId;
    });
  }

  private broadcastRaw(msg: ServerMsg, exceptPlayerId?: string): void {
    for (const socket of this.liveSockets()) {
      const attach = (socket.deserializeAttachment() ?? { playerId: null }) as Attachment;
      if (exceptPlayerId && attach.playerId === exceptPlayerId) continue;
      this.send(socket, msg);
    }
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already going away — close event will handle presence.
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { t: "error", message });
  }

  private async syncAlarm(): Promise<void> {
    const state = await this.getState();
    if (!state) return;
    const times: number[] = [];
    const paused = Object.keys(state.holds).length > 0;
    // While a seat is held the clocks can't fire (the reducer refuses them),
    // so scheduling them would only hot-loop the alarm — the hold wakes us instead.
    if (!paused && state.phase === "guessing" && state.round?.guessDeadline != null) {
      times.push(state.round.guessDeadline);
    }
    if (
      !paused &&
      (state.phase === "drawing" || state.phase === "voting") &&
      state.round?.turnDeadline != null
    ) {
      times.push(state.round.turnDeadline);
    }
    times.push(...Object.values(state.holds));
    const emptySince = await this.ctx.storage.get<number>("emptySince");
    if (emptySince !== undefined && this.liveSockets().length === 0) {
      times.push(emptySince + ROOM_TTL_MS);
    }
    if (times.length > 0) {
      await this.ctx.storage.setAlarm(Math.min(...times));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }
}
