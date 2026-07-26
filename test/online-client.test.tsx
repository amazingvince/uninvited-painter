// @vitest-environment jsdom

import { act, startTransition } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoom, reduce } from "../shared/engine";
import { redactState } from "../shared/protocol";
import type { GameEvent, RoomState } from "../shared/types";
import {
  useOnlineRoom,
  type OnlineRoom,
} from "../src/game/onlineClient";

class ControlledWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: ControlledWebSocket[] = [];

  readonly url: string;
  readyState = ControlledWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    ControlledWebSocket.instances.push(this);
  }

  send(frame: string) {
    this.sent.push(frame);
  }

  close() {
    this.readyState = ControlledWebSocket.CLOSED;
  }

  open() {
    this.readyState = ControlledWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  message(message: unknown) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }

  serverClose() {
    this.readyState = ControlledWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}

interface ControlledFetch {
  url: string;
  signal: AbortSignal | null;
  resolve: (status: number) => void;
  reject: (error: unknown) => void;
}

function apply(state: RoomState, event: GameEvent): RoomState {
  const result = reduce(state, event);
  if (!result.ok) throw new Error(`${event.type}: ${result.error}`);
  return result.state;
}

function publicRoom(code: string) {
  let state = createRoom({ code, mode: "online", hostId: "" });
  state = apply(state, {
    type: "ADD_PLAYER",
    player: {
      id: `${code}-host`,
      name: `${code} host`,
      colorIndex: 0,
    },
  });
  return redactState(state, `${code}-host`);
}

function drawingRoom(code: string) {
  let state = createRoom({ code, mode: "online", hostId: "" });
  for (let index = 0; index < 5; index += 1) {
    state = apply(state, {
      type: "ADD_PLAYER",
      player: {
        id: `${code}-p${index}`,
        name: `${code} player ${index}`,
        colorIndex: index,
      },
    });
  }
  const turnOrder = state.players.map((player) => player.id);
  state = apply(state, {
    type: "START_ROUND",
    word: "penguin",
    category: "Animals",
    qmId: null,
    fakeId: turnOrder[1],
    turnOrder,
  });
  for (const playerId of turnOrder) {
    state = apply(state, { type: "MARK_SEEN", playerId, now: 0 });
  }
  for (let index = 0; index < 4; index += 1) {
    state = apply(state, {
      type: "COMMIT_STROKE",
      playerId: state.round!.schedule[state.round!.turnIndex],
      points: [0.1, 0.1, 0.5, 0.5, 0.9, 0.9],
      now: 0,
    });
  }
  return redactState(state, `${code}-p0`);
}

const IDENTITY_CHANGES = [
  ["code", "INKS", false],
  ["watch mode", "MOLT", true],
] as const;
const NEVER_RESOLVES = new Promise<void>(() => undefined);

describe("useOnlineRoom connection ownership", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest!: OnlineRoom;
  let requests: ControlledFetch[];
  let storageValues: Map<string, string>;
  let suspendedRenders: number;

  function Harness({
    code,
    watch = false,
    suspend = false,
  }: {
    code: string;
    watch?: boolean;
    suspend?: boolean;
  }) {
    latest = useOnlineRoom(code, watch);
    if (suspend) {
      suspendedRenders += 1;
      throw NEVER_RESOLVES;
    }
    return (
      <output
        data-code={code}
        data-connection={latest.connectionState}
        data-attempt={latest.reconnectAttempt}
      />
    );
  }

  function render(code = "MOLT", watch = false) {
    act(() => root.render(<Harness code={code} watch={watch} />));
  }

  async function resolveFetch(index: number, status: number) {
    await act(async () => {
      requests[index].resolve(status);
      await Promise.resolve();
    });
  }

  function open(socket: ControlledWebSocket) {
    act(() => socket.open());
  }

  function close(socket: ControlledWebSocket) {
    act(() => socket.serverClose());
  }

  function message(socket: ControlledWebSocket, value: unknown) {
    act(() => socket.message(value));
  }

  function advance(ms: number) {
    act(() => vi.advanceTimersByTime(ms));
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    suspendedRenders = 0;
    storageValues = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => storageValues.set(key, value),
      removeItem: (key: string) => storageValues.delete(key),
      clear: () => storageValues.clear(),
    });
    ControlledWebSocket.instances = [];
    requests = [];
    vi.stubGlobal(
      "WebSocket",
      ControlledWebSocket as unknown as typeof WebSocket,
    );
    vi.stubGlobal(
      "fetch",
      ((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal ?? null;
          const request: ControlledFetch = {
            url: String(input),
            signal,
            resolve: (status) => resolve({ status } as Response),
            reject,
          };
          requests.push(request);
          signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            { once: true },
          );
        })) as typeof fetch,
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("starts the socket when the initial room probe hangs", () => {
    render();

    expect(latest.connectionState).toBe("checking");
    expect(ControlledWebSocket.instances).toHaveLength(0);

    advance(2_000);

    expect(requests[0].signal?.aborted).toBe(true);
    expect(ControlledWebSocket.instances).toHaveLength(1);
    expect(latest.connectionState).toBe("connecting");
  });

  it("resets the reconnect counter when a retry socket opens", async () => {
    render();
    await resolveFetch(0, 200);
    const first = ControlledWebSocket.instances[0];
    open(first);
    close(first);

    expect(latest.connectionState).toBe("reconnecting");
    expect(latest.reconnectAttempt).toBe(1);

    advance(600);
    const retry = ControlledWebSocket.instances[1];
    open(retry);

    expect(latest.connectionState).toBe("connected");
    expect(latest.reconnectAttempt).toBe(0);
  });

  it("marks a room gone when the fourth consecutive close is confirmed as 404", async () => {
    render();
    await resolveFetch(0, 200);

    close(ControlledWebSocket.instances[0]);
    advance(600);
    close(ControlledWebSocket.instances[1]);
    advance(1_200);
    close(ControlledWebSocket.instances[2]);
    advance(1_800);
    close(ControlledWebSocket.instances[3]);

    expect(latest.reconnectAttempt).toBe(4);
    expect(requests).toHaveLength(2);
    await resolveFetch(1, 404);

    expect(latest.connectionState).toBe("gone");
  });

  it("ignores a delayed fourth-attempt 404 after a newer socket opens", async () => {
    render();
    await resolveFetch(0, 200);

    close(ControlledWebSocket.instances[0]);
    advance(600);
    close(ControlledWebSocket.instances[1]);
    advance(1_200);
    close(ControlledWebSocket.instances[2]);
    advance(1_800);
    close(ControlledWebSocket.instances[3]);
    advance(2_400);
    const recovered = ControlledWebSocket.instances[4];
    open(recovered);

    await resolveFetch(1, 404);

    expect(latest.connectionState).toBe("connected");
    expect(latest.reconnectAttempt).toBe(0);
  });

  it("ignores obsolete socket callbacks after the room changes", async () => {
    render("MOLT");
    await resolveFetch(0, 200);
    const obsolete = ControlledWebSocket.instances[0];

    render("INKS");
    await resolveFetch(1, 200);
    const current = ControlledWebSocket.instances[1];
    open(current);
    const currentView = publicRoom("INKS");
    message(current, { t: "joined", playerId: "INKS-host" });
    message(current, { t: "state", ...currentView });

    act(() => {
      obsolete.open();
      obsolete.message({ t: "joined", playerId: "MOLT-host" });
      obsolete.message({ t: "state", ...publicRoom("MOLT") });
      obsolete.message({ t: "error", message: "This room has closed" });
      obsolete.serverClose();
    });
    act(() => latest.send({ t: "seen" }));

    expect(latest.connectionState).toBe("connected");
    expect(latest.state?.code).toBe("INKS");
    expect(latest.you?.playerId).toBe("INKS-host");
    expect(localStorage.getItem("painter.joined.MOLT")).toBeNull();
    expect(current.sent.map((frame) => JSON.parse(frame))).toContainEqual({
      t: "seen",
    });
  });

  it.each(IDENTITY_CHANGES)(
    "clears private state, live buffers, and queued actions when %s changes",
    async (_scope, nextCode, nextWatch) => {
      render("MOLT", false);
      await resolveFetch(0, 200);
      const oldSocket = ControlledWebSocket.instances[0];
      open(oldSocket);
      const oldView = publicRoom("MOLT");
      message(oldSocket, { t: "joined", playerId: "MOLT-host" });
      message(oldSocket, { t: "state", ...oldView });
      message(oldSocket, {
        t: "live",
        playerId: "MOLT-host",
        colorIndex: 0,
        points: [0.1, 0.2],
      });
      close(oldSocket);
      act(() => {
        latest.send({ t: "seen" });
        latest.sendLive([0.3, 0.4]);
      });

      render(nextCode, nextWatch);

      expect(latest.joined).toBe(false);
      expect(latest.state).toBeNull();
      expect(latest.you).toBeNull();
      expect(latest.live).toEqual({});
      expect(latest.error).toBeNull();

      await resolveFetch(1, 200);
      const newSocket = ControlledWebSocket.instances[1];
      open(newSocket);
      advance(40);

      expect(newSocket.sent).toEqual([]);
    },
  );

  async function retainCallbacksAcrossIdentityChange(
    nextCode: string,
    nextWatch: boolean,
  ) {
    render("MOLT", false);
    await resolveFetch(0, 200);
    open(ControlledWebSocket.instances[0]);
    const stale = {
      send: latest.send,
      sendLive: latest.sendLive,
      sendLiveClear: latest.sendLiveClear,
    };

    render(nextCode, nextWatch);
    await resolveFetch(1, 200);
    return {
      stale,
      current: latest,
      socket: ControlledWebSocket.instances[1],
    };
  }

  it.each(IDENTITY_CHANGES)(
    "makes a stale send inert after a %s change",
    async (_scope, nextCode, nextWatch) => {
      const { stale, socket } = await retainCallbacksAcrossIdentityChange(
        nextCode,
        nextWatch,
      );

      act(() => stale.send({ t: "seen" }));
      open(socket);

      expect(socket.sent).toEqual([]);
    },
  );

  it.each(IDENTITY_CHANGES)(
    "keeps current live points intact when stale sendLive runs after a %s change",
    async (_scope, nextCode, nextWatch) => {
      const { stale, current, socket } =
        await retainCallbacksAcrossIdentityChange(nextCode, nextWatch);
      open(socket);

      act(() => {
        current.sendLive([0.1, 0.2]);
        stale.sendLive([0.9, 1], true);
      });
      advance(40);

      expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
        { t: "live", points: [0.1, 0.2] },
      ]);
    },
  );

  it.each(IDENTITY_CHANGES)(
    "keeps the current live timer and buffer when stale sendLiveClear runs after a %s change",
    async (_scope, nextCode, nextWatch) => {
      const { stale, current, socket } =
        await retainCallbacksAcrossIdentityChange(nextCode, nextWatch);
      open(socket);

      act(() => {
        current.sendLive([0.3, 0.4]);
        stale.sendLiveClear();
      });
      advance(40);

      expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
        { t: "live", points: [0.3, 0.4] },
      ]);
    },
  );

  it("keeps committed room callbacks active when a different identity render is abandoned", async () => {
    render("MOLT");
    await resolveFetch(0, 200);
    const socket = ControlledWebSocket.instances[0];
    open(socket);
    const committedSend = latest.send;

    await act(async () => {
      startTransition(() => {
        root.render(<Harness code="INKS" suspend />);
      });
      await Promise.resolve();
    });

    expect(suspendedRenders).toBeGreaterThan(0);
    expect(container.querySelector("output")?.getAttribute("data-code")).toBe(
      "MOLT",
    );

    act(() => committedSend({ t: "seen" }));

    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { t: "seen" },
    ]);
  });

  it("rejoins before replaying queued authoritative actions", async () => {
    localStorage.setItem("painter.joined.MOLT", "1");
    localStorage.setItem("painter.token.MOLT", "token-molt");
    render();
    await resolveFetch(0, 200);
    const view = drawingRoom("MOLT");
    const scopedState = { ...view.state, gameNo: 3 };
    const socket = ControlledWebSocket.instances[0];
    open(socket);
    message(socket, { t: "state", state: scopedState, you: view.you });
    close(socket);
    act(() => latest.send({ t: "seen" }));
    advance(600);
    const retry = ControlledWebSocket.instances[1];

    open(retry);

    expect(retry.sent.map((frame) => JSON.parse(frame))).toEqual([
      { t: "rejoin", token: "token-molt" },
      {
        t: "seen",
        scope: {
          gameNo: 3,
          roundVersion: 1,
          phase: "drawing",
          roundNo: 1,
          turnIndex: 4,
        },
      },
    ]);
  });
});
