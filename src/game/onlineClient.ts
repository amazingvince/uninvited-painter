// Online room client: one WebSocket to the room's Durable Object. Clients are
// dumb — the whole state arrives on every phase change; in-progress strokes
// ride a separate ephemeral channel.

import { useCallback, useEffect, useRef, useState } from "react";
import { drawerOf } from "../../shared/engine";
import type { ClientMsg, PublicRoomState, ServerMsg, YouView } from "../../shared/protocol";
import type { StrokePoints } from "../../shared/types";
import type { LiveStroke } from "../components/CanvasBoard";
import { hasJoined, markJoined, roomToken, saveLastRoom } from "../lib/storage";

export type ConnectionState =
  | "checking"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "gone";

export interface OnlineRoom {
  connected: boolean;
  connectionState: ConnectionState;
  reconnectAttempt: number;
  joined: boolean;
  gone: boolean; // room expired / never existed
  state: PublicRoomState | null;
  you: YouView | null;
  error: string | null;
  live: Record<string, LiveStroke>;
  join: (name: string, colorIndex: number) => void;
  send: (msg: ClientMsg) => void;
  sendLive: (batch: StrokePoints, newSegment?: boolean) => void;
  sendLiveClear: () => void;
  clearError: () => void;
}

/** Ink and handshakes are worthless once replayed: live points are stale by
 *  the time the socket returns, and join/rejoin is redone on open anyway. */
const EPHEMERAL_MSGS = new Set<ClientMsg["t"]>(["live", "liveClear", "join", "rejoin"]);
const OUTBOX_MAX = 32;

export function useOnlineRoom(code: string, watch = false): OnlineRoom {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("checking");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [joined, setJoined] = useState(false);
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [you, setYou] = useState<YouView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveStroke>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const liveBuf = useRef<number[]>([]);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goneRef = useRef(false);
  const outbox = useRef<ClientMsg[]>([]);

  useEffect(() => {
    let closed = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    goneRef.current = false;
    setConnectionState("checking");
    setReconnectAttempt(0);

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        setConnectionState("connected");
        setReconnectAttempt(0);
        // Watchers never take a seat — they just listen to the broadcasts.
        if (!watch && hasJoined(code)) {
          ws.send(JSON.stringify({ t: "rejoin", token: roomToken(code) } satisfies ClientMsg));
        }
        // Replay what the player did while the socket was down — after the
        // rejoin, so the room knows whose actions these are.
        const queued = outbox.current;
        outbox.current = [];
        for (const msg of queued) ws.send(JSON.stringify(msg));
      };

      ws.onmessage = (e) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(e.data as string);
        } catch {
          return;
        }
        switch (msg.t) {
          case "joined":
            setJoined(true);
            setError(null);
            markJoined(code);
            saveLastRoom(code);
            break;
          case "state": {
            setState(msg.state);
            setYou(msg.you);
            // In-progress overlays only make sense for the current drawer.
            const drawer =
              msg.state.phase === "drawing" && msg.state.round
                ? drawerOf(msg.state.round)
                : null;
            setLive((prev) => {
              const next: Record<string, LiveStroke> = {};
              if (drawer && prev[drawer]) next[drawer] = prev[drawer];
              return next;
            });
            break;
          }
          case "live":
            setLive((prev) => {
              const existing = prev[msg.playerId];
              if (!existing) {
                return {
                  ...prev,
                  [msg.playerId]: { colorIndex: msg.colorIndex, points: [...msg.points], breaks: [] },
                };
              }
              const breaks = existing.breaks ?? [];
              return {
                ...prev,
                [msg.playerId]: {
                  colorIndex: msg.colorIndex,
                  points: [...existing.points, ...msg.points],
                  breaks: msg.newSegment ? [...breaks, existing.points.length / 2] : breaks,
                },
              };
            });
            break;
          case "liveClear":
            setLive((prev) => {
              const next = { ...prev };
              delete next[msg.playerId];
              return next;
            });
            break;
          case "error":
            if (msg.message.startsWith("No seat to rejoin")) {
              setJoined(false);
            } else if (msg.message === "This room has closed") {
              goneRef.current = true;
              setConnectionState("gone");
            } else {
              setError(msg.message);
            }
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closed || goneRef.current) return;
        attempts += 1;
        setConnectionState("reconnecting");
        setReconnectAttempt(attempts);
        if (attempts % 4 === 0) {
          // Repeated failures — check whether the room still exists at all.
          fetch(`/api/rooms/${code}`).then((res) => {
            if (res.status === 404) {
              goneRef.current = true;
              setConnectionState("gone");
            }
          }).catch(() => {});
        }
        retryTimer = setTimeout(connect, Math.min(5000, 600 * attempts));
      };
      ws.onerror = () => {
        // onclose follows and handles the retry
      };
    };

    // A 404 on upgrade means the room is gone — probe once so we can say so.
    fetch(`/api/rooms/${code}`)
      .then((res) => {
        if (closed) return;
        if (res.status === 404) {
          goneRef.current = true;
          setConnectionState("gone");
        } else {
          setConnectionState("connecting");
          connect();
        }
      })
      .catch(() => {
        if (closed) return;
        setConnectionState("connecting");
        connect();
      });

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close(1000, "bye");
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, watch]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return;
    }
    // Anything the player actually decided has to survive a flaky socket.
    // Dropping a "seen" is how one locked phone leaves an entire room waiting
    // on a card that was read minutes ago; dropping a "commit" loses a stroke
    // with no trace. The DO re-validates every replayed message, so a stale
    // one is refused rather than misapplied.
    if (!EPHEMERAL_MSGS.has(msg.t) && outbox.current.length < OUTBOX_MAX) {
      outbox.current.push(msg);
    }
  }, []);

  /** Clear the in-flight ink, cancelling anything still sitting in the buffer.
   *  Sending the clear on its own would race the 40ms flush and leave a
   *  phantom nib on every spectator's screen for the rest of the turn. */
  const sendLiveClear = useCallback(() => {
    if (liveTimer.current !== null) {
      clearTimeout(liveTimer.current);
      liveTimer.current = null;
    }
    liveBuf.current = [];
    send({ t: "liveClear" });
  }, [send]);

  const join = useCallback(
    (name: string, colorIndex: number) => {
      send({ t: "join", token: roomToken(code), name, colorIndex });
    },
    [code, send],
  );

  const sendLive = useCallback(
    (batch: StrokePoints, newSegment = false) => {
      if (newSegment) {
        // Flush the previous segment's tail, then mark the fresh one.
        if (liveTimer.current !== null) {
          clearTimeout(liveTimer.current);
          liveTimer.current = null;
        }
        const tail = liveBuf.current;
        liveBuf.current = [];
        if (tail.length > 0) send({ t: "live", points: tail });
        send({ t: "live", points: [...batch], newSegment: true });
        return;
      }
      liveBuf.current.push(...batch);
      if (liveTimer.current === null) {
        liveTimer.current = setTimeout(() => {
          liveTimer.current = null;
          const points = liveBuf.current;
          liveBuf.current = [];
          if (points.length > 0) send({ t: "live", points });
        }, 40);
      }
    },
    [send],
  );

  const clearError = useCallback(() => setError(null), []);
  const connected = connectionState === "connected";
  const gone = connectionState === "gone";

  return {
    connected, connectionState, reconnectAttempt, joined, gone, state, you, error, live,
    join, send, sendLive, sendLiveClear, clearError,
  };
}
