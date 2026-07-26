// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, shareLink } from "../src/lib/actionResult";
import { shareOrDownload } from "../src/lib/share";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser action results", () => {
  it("reports copied text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyText("room", { writeText })).resolves.toBe("done");
    expect(writeText).toHaveBeenCalledWith("room");
  });

  it("reports an unavailable clipboard", async () => {
    await expect(copyText("room", undefined)).resolves.toBe("unavailable");
  });

  it("keeps default adapters safe without browser globals", async () => {
    vi.stubGlobal("navigator", undefined);

    await expect(copyText("room")).resolves.toBe("unavailable");
    await expect(shareLink({ url: "/r/ABCD" })).resolves.toBe("unavailable");
  });

  it("distinguishes share cancellation from failure", async () => {
    const cancelled = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));
    await expect(
      shareLink({ title: "Game", url: "/r/ABCD" }, cancelled),
    ).resolves.toBe("cancelled");

    const failed = vi.fn().mockRejectedValue(new Error("blocked"));
    await expect(
      shareLink({ title: "Game", url: "/r/ABCD" }, failed),
    ).resolves.toBe("failed");
  });
});

describe("share or download", () => {
  it("reports cancelled native sharing without downloading", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));
    vi.stubGlobal("navigator", {
      share,
      canShare: () => true,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await expect(
      shareOrDownload(new Blob(["png"]), "drawing.png"),
    ).resolves.toBe("cancelled");
    expect(click).not.toHaveBeenCalled();
  });

  it("downloads when native file sharing is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:drawing"),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await expect(
      shareOrDownload(new Blob(["png"]), "drawing.png"),
    ).resolves.toBe("done");
    expect(click).toHaveBeenCalledOnce();
  });
});
