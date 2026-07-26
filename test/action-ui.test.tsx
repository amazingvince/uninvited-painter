// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoom, reduce } from "../shared/engine";
import { redactState } from "../shared/protocol";
import type { ArchiveEntry, GameEvent, Player, RoomState } from "../shared/types";
import { ArchivePage } from "../src/screens/ArchivePage";
import { Final } from "../src/screens/Final";
import { HostLobby } from "../src/screens/HostLobby";

const share = vi.hoisted(() => ({
  contactSheetPng: vi.fn(),
  drawingPng: vi.fn(),
  publishArchive: vi.fn(),
  shareOrDownload: vi.fn(),
}));

vi.mock("../src/lib/share", () => share);

function apply(state: RoomState, event: GameEvent): RoomState {
  const result = reduce(state, event);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function lobbyState() {
  let state = createRoom({ code: "MOLT", mode: "online", hostId: "" });
  for (const [index, name] of ["Devon", "Maya", "Priya"].entries()) {
    state = apply(state, {
      type: "ADD_PLAYER",
      player: { id: `p${index}`, name, colorIndex: index },
    });
  }
  return redactState(state, "p0").state;
}

const PLAYERS: Player[] = [
  { id: "p0", name: "Devon", colorIndex: 0, score: 4, connected: true },
  { id: "p1", name: "Maya", colorIndex: 1, score: 2, connected: true },
];

function archiveEntry(pending = false): ArchiveEntry {
  return {
    roundNo: 1,
    word: "penguin",
    strokes: [],
    outcome: "survived",
    fakeName: "Devon",
    fakeId: "p0",
    ai: pending
      ? {
          jobId: "00000000-0000-4000-8000-000000000001",
          criticStatus: "pending",
          critic: null,
          renditionStatus: "pending",
          renditionId: null,
        }
      : undefined,
  };
}

function publishedArchive(pending = false) {
  return {
    title: "Devon takes the gallery",
    players: PLAYERS.map(({ name, colorIndex, score }) => ({
      name,
      colorIndex,
      score,
    })),
    entries: [archiveEntry(pending)],
    createdAt: Date.UTC(2026, 6, 25),
  };
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`Expected button containing “${text}”`);
  return button;
}

function response(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe("observable browser actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    share.contactSheetPng.mockReset();
    share.drawingPng.mockReset();
    share.publishArchive.mockReset();
    share.shareOrDownload.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  function renderLobby() {
    act(() => {
      root.render(
        <HostLobby
          state={lobbyState()}
          youId="p0"
          isHost
          shareUrl="https://example.test/r/MOLT"
          onSettings={() => undefined}
          onStart={() => undefined}
          onRules={() => undefined}
          onHouseWords={() => undefined}
        />,
      );
    });
  }

  it("reports each lobby copy and hides unsupported native sharing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderLobby();

    expect(container.textContent).not.toContain("Share sheet");
    expect(container.textContent).toContain("example.test/r/MOLT");

    await act(async () => {
      buttonWithText(container, "Copy link").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Room link copied",
    );

    await act(async () => {
      buttonWithText(container, "Copy spectator link").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Spectator link copied",
    );
  });

  it("reports unavailable lobby actions without hiding the visible URL", async () => {
    const shareAction = vi.fn();
    vi.stubGlobal("navigator", { share: shareAction });
    renderLobby();

    await act(async () => {
      buttonWithText(container, "Copy link").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not copy — select the visible URL",
    );

    Reflect.deleteProperty(
      globalThis.navigator as Navigator & { share?: Navigator["share"] },
      "share",
    );
    await act(async () => {
      buttonWithText(container, "Share sheet").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Sharing is not available — copy the link instead",
    );
  });

  it("publishes without sharing, then exposes separate copy and share actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nativeShare = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
      share: nativeShare,
    });
    share.publishArchive.mockResolvedValue("https://example.test/a/paint");

    act(() => {
      root.render(
        <Final
          players={PLAYERS}
          archive={[archiveEntry()]}
          onAgain={() => undefined}
        />,
      );
    });
    await act(async () => {
      buttonWithText(container, "Publish the archive").click();
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(nativeShare).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Published");
    expect(container.textContent).toContain("example.test/a/paint");
    expect(buttonWithText(container, "Copy archive link")).not.toBeNull();
    expect(buttonWithText(container, "Share archive")).not.toBeNull();

    await act(async () => {
      buttonWithText(container, "Copy archive link").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Archive link copied",
    );

    await act(async () => {
      buttonWithText(container, "Share archive").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Sharing cancelled",
    );
  });

  it("keeps the finished game visible and retries a failed publish", async () => {
    share.publishArchive
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("https://example.test/a/recovered");
    act(() => {
      root.render(
        <Final
          players={PLAYERS}
          archive={[archiveEntry()]}
          onAgain={() => undefined}
        />,
      );
    });

    await act(async () => {
      buttonWithText(container, "Publish the archive").click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Devon takes");
    expect(container.textContent).toContain("Same crowd, again");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Publishing failed",
    );

    await act(async () => {
      buttonWithText(container, "Publishing failed").click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Published");
    expect(share.publishArchive).toHaveBeenCalledTimes(2);
  });

  it("reports a cancelled archive PNG save without claiming completion", async () => {
    share.contactSheetPng.mockResolvedValue(new Blob(["png"]));
    share.shareOrDownload.mockResolvedValue("cancelled");
    act(() => {
      root.render(
        <Final
          players={PLAYERS}
          archive={[archiveEntry()]}
          onAgain={() => undefined}
        />,
      );
    });

    await act(async () => {
      buttonWithText(container, "Save as PNG instead").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Saving cancelled",
    );
    expect(container.textContent).not.toContain("Archive PNG saved");
  });
});

describe("published archive loading", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  async function renderArchive() {
    await act(async () => {
      root.render(<ArchivePage id="paint" onHome={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("describes only a 404 as a retained archive that is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(404, {})));
    await renderArchive();

    expect(container.textContent).toContain("Nothing hangs");
    expect(container.textContent).toContain("Archives are kept for a year");
    expect(buttonWithText(container, "To the entrance")).not.toBeNull();
  });

  it.each([
    ["server error", () => Promise.resolve(response(500, {}))],
    ["network error", () => Promise.reject(new Error("offline"))],
  ])("offers retry after an initial %s", async (_label, firstFailure) => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(firstFailure)
      .mockResolvedValueOnce(response(200, publishedArchive()));
    vi.stubGlobal("fetch", fetchMock);
    await renderArchive();

    expect(container.textContent).toContain("Temporary problem");
    expect(container.textContent).not.toContain("Archives are kept for a year");
    await act(async () => {
      buttonWithText(container, "Retry").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Devon takes the gallery");
  });

  it("keeps a loaded archive visible through a later poll failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, publishedArchive(true)))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await renderArchive();

    expect(container.textContent).toContain("Devon takes the gallery");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Devon takes the gallery");
    expect(container.textContent).not.toContain("Temporary problem");
  });
});
