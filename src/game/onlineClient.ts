// Online room client: one WebSocket to the room's Durable Object. Clients are
// dumb — the whole state arrives on every phase change; in-progress strokes
// ride a separate ephemeral channel.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, PublicRoomState, ServerMsg, YouView } from "../../shared/protocol";
import type { StrokePoints } from "../../shared/types";
import type { LiveStroke } from "../components/CanvasBoard";
import { hasJoined, markJoined, roomToken, saveLastRoom } from "../lib/storage";

export interface OnlineRoom {
  connected: boolean;
  joined: boolean;
  gone: boolean; // room expired / never existed
  state: PublicRoomState | null;
  you: YouView | null;
  error: string | null;
  live: Record<string, LiveStroke>;
  join: (name: string, colorIndex: number) => void;
  send: (msg: ClientMsg) => void;
  sendLive: (batch: StrokePoints) => void;
  clearError: () => void;
}

export function useOnlineRoom(code: string): OnlineRoom {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [gone, setGone] = useState(false);
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [you, setYou] = useState<YouView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveStroke>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const liveBuf = useRef<number[]>([]);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goneRef = useRef(false);

  useEffect(() => {
    let closed = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        setConnected(true);
        if (hasJoined(code)) {
          ws.send(JSON.stringify({ t: "rejoin", token: roomToken(code) } satisfies ClientMsg));
        }
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
                ? msg.state.round.schedule[msg.state.round.turnIndex]
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
              return {
                ...prev,
                [msg.playerId]: {
                  colorIndex: msg.colorIndex,
                  points: existing ? [...existing.points, ...msg.points] : [...msg.points],
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
              setGone(true);
            } else {
              setError(msg.message);
            }
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (closed || goneRef.current) return;
        attempts += 1;
        if (attempts % 4 === 0) {
          // Repeated failures — check whether the room still exists at all.
          fetch(`/api/rooms/${code}`).then((res) => {
            if (res.status === 404) {
              goneRef.current = true;
              setGone(true);
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
        if (res.status === 404) {
          goneRef.current = true;
          setGone(true);
        } else {
          connect();
        }
      })
      .catch(() => connect());

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close(1000, "bye");
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const join = useCallback(
    (name: string, colorIndex: number) => {
      send({ t: "join", token: roomToken(code), name, colorIndex });
    },
    [code, send],
  );

  const sendLive = useCallback(
    (batch: StrokePoints) => {
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

  return { connected, joined, gone, state, you, error, live, join, send, sendLive, clearError };
}
