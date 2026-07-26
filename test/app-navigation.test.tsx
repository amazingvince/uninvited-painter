// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

class PendingWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = PendingWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  send() {}

  close() {
    this.readyState = PendingWebSocket.CLOSED;
  }
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`Expected button named ${name}`);
  return button;
}

describe("App route transitions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    history.replaceState(null, "", "/");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    });
    vi.stubGlobal("WebSocket", PendingWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/rooms") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ code: "VJPR" }),
          } as Response;
        }
        return { ok: true, status: 200 } as Response;
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("keeps room UI mounted when create-room navigation changes the route", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    act(() => root.render(<App />));
    act(() => buttonNamed(container, "Play online→").click());

    await act(async () => {
      buttonNamed(container, "Open a roomYou get a code and a link to send. 5–12 painters.").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(location.pathname).toBe("/r/VJPR");
    expect(container.textContent).toContain("Room VJPR");
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("Rendered fewer hooks than expected"),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });
});
