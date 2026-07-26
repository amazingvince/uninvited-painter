// Online room client: one WebSocket to the room's Durable Object. Clients are
// dumb — the whole state arrives on every phase change; in-progress strokes
// ride a separate ephemeral channel.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { drawerOf } from "../../shared/engine";
import {
  isAuthoritativeClientMsg,
  scopeClientMsg,
  type ClientMsg,
  type PublicRoomState,
  type ServerMsg,
  type YouView,
} from "../../shared/protocol";
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
const INITIAL_PROBE_TIMEOUT_MS = 1_200;

export function useOnlineRoom(code: string, watch = false): OnlineRoom {
  const roomIdentity = `${code}\u0000${watch ? "watch" : "play"}`;
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("checking");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [joined, setJoined] = useState(false);
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [you, setYou] = useState<YouView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveStroke>>({});
  const stateRef = useRef<PublicRoomState | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const liveBuf = useRef<number[]>([]);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goneRef = useRef(false);
  const effectGenerationRef = useRef(0);
  const activeIdentityRef = useRef(roomIdentity);
  const requestedIdentityRef = useRef(roomIdentity);
  const wsIdentityRef = useRef<string | null>(null);
  const outbox = useRef<{ generation: number; messages: ClientMsg[] }>({
    generation: 0,
    messages: [],
  });
  useLayoutEffect(() => {
    requestedIdentityRef.current = roomIdentity;
  }, [roomIdentity]);

  useEffect(() => {
    const generation = effectGenerationRef.current + 1;
    effectGenerationRef.current = generation;
    activeIdentityRef.current = roomIdentity;
    let closed = false;
    let attempts = 0;
    let openedSockets = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let initialProbeTimer: ReturnType<typeof setTimeout> | null = null;
    let initialProbePending = true;
    const probeControllers = new Set<AbortController>();

    if (liveTimer.current !== null) {
      clearTimeout(liveTimer.current);
      liveTimer.current = null;
    }
    liveBuf.current = [];
    outbox.current = { generation, messages: [] };
    goneRef.current = false;
    setConnectionState("checking");
    setReconnectAttempt(0);
    setJoined(false);
    stateRef.current = null;
    setState(null);
    setYou(null);
    setError(null);
    setLive({});

    const isCurrentEffect = () =>
      !closed &&
      effectGenerationRef.current === generation &&
      activeIdentityRef.current === roomIdentity;

    const abortProbes = () => {
      for (const controller of probeControllers) controller.abort();
      probeControllers.clear();
    };

    const markGone = () => {
      if (!isCurrentEffect()) return;
      goneRef.current = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      abortProbes();
      const activeSocket = wsRef.current;
      if (activeSocket && wsIdentityRef.current === roomIdentity) {
        wsRef.current = null;
        wsIdentityRef.current = null;
        activeSocket.close(1000, "gone");
      }
      setConnectionState("gone");
    };

    const connect = () => {
      if (!isCurrentEffect() || goneRef.current) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
      wsRef.current = ws;
      wsIdentityRef.current = roomIdentity;

      const isCurrentSocket = () =>
        isCurrentEffect() &&
        !goneRef.current &&
        wsRef.current === ws &&
        wsIdentityRef.current === roomIdentity;

      ws.onopen = () => {
        if (!isCurrentSocket()) return;
        openedSockets += 1;
        abortProbes();
        attempts = 0;
        setConnectionState("connected");
        setReconnectAttempt(0);
        // Watchers never take a seat — they just listen to the broadcasts.
        if (!watch && hasJoined(code)) {
          ws.send(JSON.stringify({ t: "rejoin", token: roomToken(code) } satisfies ClientMsg));
        }
        // Replay what the player did while the socket was down — after the
        // rejoin, so the room knows whose actions these are.
        const queued =
          outbox.current.generation === generation
            ? outbox.current.messages
            : [];
        outbox.current = { generation, messages: [] };
        for (const msg of queued) ws.send(JSON.stringify(msg));
      };

      ws.onmessage = (e) => {
        if (!isCurrentSocket()) return;
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
            stateRef.current = msg.state;
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
              markGone();
            } else {
              setError(msg.message);
            }
            break;
        }
      };

      ws.onclose = () => {
        if (!isCurrentSocket()) return;
        wsRef.current = null;
        wsIdentityRef.current = null;
        attempts += 1;
        setConnectionState("reconnecting");
        setReconnectAttempt(attempts);
        if (attempts % 4 === 0) {
          // Repeated failures — check whether the room still exists at all.
          const openedAtProbe = openedSockets;
          const controller = new AbortController();
          probeControllers.add(controller);
          fetch(`/api/rooms/${code}`, { signal: controller.signal })
            .then((res) => {
              probeControllers.delete(controller);
              if (
                !isCurrentEffect() ||
                controller.signal.aborted ||
                openedSockets !== openedAtProbe
              ) {
                return;
              }
              if (res.status === 404) markGone();
            })
            .catch(() => {
              probeControllers.delete(controller);
            });
        }
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect();
        }, Math.min(5000, 600 * attempts));
      };
      ws.onerror = () => {
        // onclose follows and handles the retry
      };
    };

    const beginConnecting = () => {
      if (!isCurrentEffect() || goneRef.current) return;
      setConnectionState("connecting");
      connect();
    };

    // A 404 on upgrade means the room is gone — probe once so we can say so.
    const initialProbeController = new AbortController();
    probeControllers.add(initialProbeController);
    initialProbeTimer = setTimeout(() => {
      if (!initialProbePending || !isCurrentEffect()) return;
      initialProbePending = false;
      probeControllers.delete(initialProbeController);
      initialProbeController.abort();
      beginConnecting();
    }, INITIAL_PROBE_TIMEOUT_MS);
    fetch(`/api/rooms/${code}`, { signal: initialProbeController.signal })
      .then((res) => {
        if (!initialProbePending) return;
        initialProbePending = false;
        probeControllers.delete(initialProbeController);
        if (initialProbeTimer !== null) {
          clearTimeout(initialProbeTimer);
          initialProbeTimer = null;
        }
        if (!isCurrentEffect()) return;
        if (res.status === 404) {
          markGone();
        } else {
          beginConnecting();
        }
      })
      .catch(() => {
        if (!initialProbePending) return;
        initialProbePending = false;
        probeControllers.delete(initialProbeController);
        if (initialProbeTimer !== null) {
          clearTimeout(initialProbeTimer);
          initialProbeTimer = null;
        }
        beginConnecting();
      });

    return () => {
      closed = true;
      initialProbePending = false;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (initialProbeTimer !== null) clearTimeout(initialProbeTimer);
      abortProbes();
      if (liveTimer.current !== null) {
        clearTimeout(liveTimer.current);
        liveTimer.current = null;
      }
      liveBuf.current = [];
      if (
        wsRef.current !== null &&
        wsIdentityRef.current === roomIdentity
      ) {
        const socket = wsRef.current;
        wsRef.current = null;
        wsIdentityRef.current = null;
        socket.close(1000, "bye");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, roomIdentity, watch]);

  const send = useCallback((msg: ClientMsg) => {
    if (
      requestedIdentityRef.current !== roomIdentity ||
      activeIdentityRef.current !== roomIdentity
    ) {
      return;
    }
    const ws = wsRef.current;
    if (
      ws &&
      wsIdentityRef.current === roomIdentity &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(JSON.stringify(msg));
      return;
    }
    // Anything the player actually decided has to survive a flaky socket.
    // Dropping a "seen" is how one locked phone leaves an entire room waiting
    // on a card that was read minutes ago; dropping a "commit" loses a stroke
    // with no trace. The DO re-validates every replayed message, so a stale
    // one is refused rather than misapplied.
    const generation = effectGenerationRef.current;
    if (outbox.current.generation !== generation) {
      outbox.current = { generation, messages: [] };
    }
    if (
      !EPHEMERAL_MSGS.has(msg.t) &&
      outbox.current.messages.length < OUTBOX_MAX
    ) {
      if (!isAuthoritativeClientMsg(msg) || !stateRef.current) return;
      outbox.current.messages.push(scopeClientMsg(msg, stateRef.current));
    }
  }, [roomIdentity]);

  /** Clear the in-flight ink, cancelling anything still sitting in the buffer.
   *  Sending the clear on its own would race the 40ms flush and leave a
   *  phantom nib on every spectator's screen for the rest of the turn. */
  const sendLiveClear = useCallback(() => {
    if (
      requestedIdentityRef.current !== roomIdentity ||
      activeIdentityRef.current !== roomIdentity
    ) {
      return;
    }
    if (liveTimer.current !== null) {
      clearTimeout(liveTimer.current);
      liveTimer.current = null;
    }
    liveBuf.current = [];
    send({ t: "liveClear" });
  }, [roomIdentity, send]);

  const join = useCallback(
    (name: string, colorIndex: number) => {
      send({ t: "join", token: roomToken(code), name, colorIndex });
    },
    [code, send],
  );

  const sendLive = useCallback(
    (batch: StrokePoints, newSegment = false) => {
      if (
        requestedIdentityRef.current !== roomIdentity ||
        activeIdentityRef.current !== roomIdentity
      ) {
        return;
      }
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
        const identity = roomIdentity;
        liveTimer.current = setTimeout(() => {
          liveTimer.current = null;
          if (activeIdentityRef.current !== identity) {
            liveBuf.current = [];
            return;
          }
          const points = liveBuf.current;
          liveBuf.current = [];
          if (points.length > 0) send({ t: "live", points });
        }, 40);
      }
    },
    [roomIdentity, send],
  );

  const clearError = useCallback(() => setError(null), []);
  const scopeIsCurrent = activeIdentityRef.current === roomIdentity;
  const visibleConnectionState = scopeIsCurrent ? connectionState : "checking";
  const visibleReconnectAttempt = scopeIsCurrent ? reconnectAttempt : 0;
  const connected = visibleConnectionState === "connected";
  const gone = visibleConnectionState === "gone";

  return {
    connected,
    connectionState: visibleConnectionState,
    reconnectAttempt: visibleReconnectAttempt,
    joined: scopeIsCurrent ? joined : false,
    gone,
    state: scopeIsCurrent ? state : null,
    you: scopeIsCurrent ? you : null,
    error: scopeIsCurrent ? error : null,
    live: scopeIsCurrent ? live : {},
    join, send, sendLive, sendLiveClear, clearError,
  };
}
